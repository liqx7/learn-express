var loadtest= require('loadtest');
var expect=require('chai').expect;

suite('stress tests', function(){
  test('hompage should handle 100requests in asecond',function(done){
    var options={
      url:'http://localhost:3000',
      concurrency:4,
      maxRequests:100
    };
    loadtest.loadTest(options,function(err,result){
      expect(!err);
      expect(result.totalTimeSeconds<1);
      done();
    })
  })
})