var https = require("https");
var express = require("express");
var formidable = require("formidable");
var jqupload = require("jquery-file-upload-middleware");
// var nodemailer = require("nodemailer");
var http = require("http");

var credentials = require("./credentials");
var fortune = require("./lib/fortune");
var Vacation = require("./models/vacation.js");
var rest = require("connect-rest");
// var mailTransport = nodemailer.createTransport('SMTP',{
//   service:'163',
//   auth:{
//     user:credentials.n163.user,
//     pass:credentials.n163.pass,
//   }
// })

// mailTransport.sendMail({
//   from:'sss',
//   to:'805699836@qq.com',
//   subject:'aa',
//   text:'sssss',
// },function(err){
//   if(err) console.log('err!')
// })

var app = express();

var handlebars = require("express3-handlebars").create({
  defaultLayout: "main",
  // extname: '.hbs',
  helpers: {
    section: function(name, options) {
      if (!this._sections) this._sections = {};
      this._sections[name] = options.fn(this);
      return null;
    },
    static: function(name) {
      return require("./lib/static.js").map(name);
    }
  }
});
app.engine("handlebars", handlebars.engine);
app.set("view engine", "handlebars");

app.set("port", process.env.PORT || 3000);

app.use("/api", require("cors")());

// 每个请求创建一个域，独立域处理请求，追踪请求中所有未捕获错误并且做出响应
app.use(function(req, res, next) {
  // 为这个请求创建域
  var domain = require("domain").create();
  // 处理这个域中的错误
  domain.on("error", function(err) {
    console.error("Domain error caught\n", err.stack);
    try {
      // 5秒内故障保护关机
      setTimeout(function() {
        console.error("Failsafe shutdown");
        process.exit(1);
      }, 5000);

      // 从集群断开
      var worker = require("cluster").worker;
      if (worker) worker.disconnect();

      // 停止接收新请求
      server.close();

      try {
        // 尝试使用express错误路由
        next(err);
      } catch (err) {
        // 如果expres错误路由失效，尝试返普通文本响应
        console.error("express error machine failed. \n", err.stack);
        res.statusCode = 500;
        res.setHeader("content-type", "text/plain");
        res.end("server error.");
      }
    } catch (err) {
      console.error("unable to send 500 response.\n", err.stack);
    }
  });
  // 向域中添加请求和响应
  domain.add(req);
  domain.add(res);

  // 执行该域中剩余的请求链
  domain.run(next);
});

// 静态文件中间件
// 使用static将文件变为静态文件目录，直接访问可将文件读取、传输到客户端
app.use(express.static(__dirname + "/public"));

app.use(require("body-parser")());
// 根据路由判断是测试进行还是正常加载
app.use(function(req, res, next) {
  // console.log(`------11, app.get("env")------`);
  // console.log(11, app.get("env"), req);
  res.locals.showTests =
    app.get("env") !== "production" && req.query.test === "1";
  next();
});

// cookie
app.use(require("cookie-parser")(credentials.cookieSecret));

// 服务器会话内存存储
app.use(require("express-session")());

// 将数据传入上下文
app.use(function(req, res, next) {
  if (!res.locals.partials) res.locals.partials = {};
  res.locals.partials.weather = {
    locations: [{ name: "1", weather: "a" }, { name: "2", weather: "b" }]
  };
  next();
});

// 不同工作线程处理不同请求
app.use(function(req, res, next) {
  var cluster = require("cluster");
  if (cluster.isWorker) {
    console.log("Worker %d received request", cluster.worker.id);
  }
  next();
});

// 拆分路由
require("./routes.js")(app);

app.use("/upload", function(req, res, next) {
  var now = Date.now();
  jqupload.fileHandler({
    uploadDir: function() {
      return __dirname + "/public/uploads/" + now;
    },
    uploadUrl: function() {
      return "/uploads/" + now;
    }
  })(req, res, next);
});

app.get("/jquerytest", function(req, res) {
  res.render("jquerytest");
});

app.get("/tours/hood-river", function(req, res) {
  res.render("tours/hood-river");
});

app.get("/tours/request-group-rate", function(req, res) {
  res.render("tours/request-group-rate");
});

app.get("/nursery-rhyme", function(req, res) {
  res.render("nursery-rhyme");
});

app.get("/data/nursery-rhyme", function(req, res) {
  res.json({
    animal: "bbbbb"
  });
});

app.get("/contest/vacation-photo", function(req, res) {
  var now = new Date();
  res.render("contest/vacation-photo", {
    year: now.getFullYear(),
    month: now.getMonth()
  });
});

app.post("/contest/vacation-photo/:year/:month", function(req, res) {
  var form = new formidable.IncomingForm();
  form.parse(req, function(err, fields, files) {
    if (err) {
      return res.redirect(303, "/error");
    }
    console.log("receive", fields, "files", files);
    res.redirect(303, "/thank-you");
  });
});

app.get("/vacations", function(req, res) {
  Vacation.find({ available: true }, function(err, vacations) {
    var context = {
      vacations: vacations.map(function(vacation) {
        return {
          sku: vacation.sku,
          name: vacation.name,
          description: vacation.description,
          price: vacation.getDisplayPrice(),
          inSeason: vacation.inSeason
        };
      })
    };
    res.render("vacations", context);
  });
});

app.get("/error", function(req, res) {
  res.render("error");
});

app.get("/thank-you", function(req, res) {
  res.render("thank-you");
});

app.get("/fail", function(req, res) {
  throw new Error("Nope!");
});

app.get("/epic-fail", function(req, res) {
  process.nextTick(function() {
    throw new Error("kaboom!");
  });
});

// 根据文件路由自动访问
var autoViews = {};
var fs = require("fs");

app.use(function(req, res, next) {
  var path = req.path.toLowerCase();
  // 检查缓存
  if (autoViews[path]) return res.render(autoViews[path]);
  // 不在缓存。匹配文件
  if (fs.existsSync(__dirname + "/views" + path + ".handlebars")) {
    autoViews[path] = path.replace(/^\//, ""); // 转成文件名
    return render(autoViews[path]);
  }
  // 没发现 转404
  next();
});

app.use(function(err, res) {
  // res.type('text/plain');
  res.status(404);
  // res.send('404 - Not Found');
  res.render("404");
});

app.use(function(err, req, res, next) {
  console.error(err);
  // res.type('txt/plain');
  res.status(500);
  // res.send('500 - server error');
  res.render("500");
});

// 日志
switch (app.get("env")) {
  case "development":
    // 彩色日志
    app.use(require("morgan")("dev"));
    break;
  case "production":
    app.use(
      require("express-logger")({
        path: __dirname + "/log/requests.log"
      })
    );
    break;
}

// app.listen(app.get("port"), function() {
//   console.log("start on" + app.get("port"));
//   console.log("env:" + app.get("env"));
// });

// http.createServer(app).listen(app.get("port"), function() {
//   console.log("start on" + app.get("port"));
//   console.log("env:" + app.get("env"));
// });

function startServer() {
  // http.createServer(app).listen(app.get("port"), function() {
  //   console.log("start on" + app.get("port"));
  //   console.log("env:" + app.get("env"));
  // });

  var options = {
    key: fs.readFileSync(__dirname + "/ssl/meadowlark.pem"),
    cert: fs.readFileSync(__dirname + "/ssl/meadowlark.crt")
  };
  https.createServer(options, app).listen(app.get("port"), function() {
    console.log("start on" + app.get("port"));
    console.log("env:" + app.get("env"));
  });
}

if (require.main === module) {
  // 应用程序直接运行，启动服务器
  startServer();
} else {
  // 应用程序作为模块引入到别的地方创建服务
  module.exports = startServer;
}

// mongodb
// var mongoose = require("mongoose");
// var opts = {
//   server: {
//     // socketOptions: { keepAlive: 1 },
//     useNewUrlParser: true
//   }
// };

// switch (app.get("env")) {
//   case "development":
//     mongoose.connect(credentials.mongo.development.connectionString, opts);
//     break;
//   case "production":
//     mongoose.connect(credentials.mongo.development.connectionString, opts);
//     break;
//   default:
//     throw new Error("unkown execution environment:" + app.get("env"));
// }

// 添加初始数据
// Vacation.find(function(err, vacations) {
//   console.log(`------vacations------`);
//   console.log(vacations);
//   if (vacations.length) return;

//   new Vacation({
//     name: "t1",
//     name: "t1",
//     slug: "t1",
//     category: "t1",
//     sku: "t1",
//     description: "t1",
//     priceIncents: 1,
//     tags: ["t1"],
//     inSeason: true,
//     maximumGuests: 1,
//     notes: "t1",
//     packageSold: 1
//   }).save();

//   new Vacation({
//     name: "t2",
//     name: "t2",
//     slug: "t2",
//     category: "t2",
//     sku: "t2",
//     description: "t2",
//     priceIncents: 2,
//     tags: ["t2"],
//     inSeason: true,
//     maximumGuests: 2,
//     notes: "t2",
//     packageSold: 2
//   }).save();

//   new Vacation({
//     name: "t3",
//     name: "t3",
//     slug: "t3",
//     category: "t3",
//     sku: "t3",
//     description: "t3",
//     priceIncents: 3,
//     tags: ["t3"],
//     inSeason: false,
//     maximumGuests: 3,
//     notes: "t3",
//     packageSold: 3
//   }).save();
// });
