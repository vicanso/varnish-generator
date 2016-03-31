'use strict';
const assert = require('assert');
const varnishGenerator = require('..');
const request = require('superagent');

function get(url) {
  return new Promise((resolve, reject) => {
    request.get(`http://localhost:8112${url}`).end((err, res) => {
      if (err) {
        reject(err);
      } else {
        resolve(res);
      }
    });
  });
}

function delay(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}


describe('varnish', () => {
  describe('cacheable', () => {
    // 首次无缓存，从backend中获取数据
    it('response from backend success', done => {
      get('/1').then(res => {
        assert(res.text);
        assert.equal(res.get('x-hits'), '0');
        done();
      }).catch(done);
    });

    // 已有缓存，从缓存中读取
    it('response from cache success', done => {
      get('/1').then(res => {
        assert(res.text);
        assert.equal(res.get('x-hits'), '1');
        done();
      }).catch(done);
    });

    // 无缓存，多请求并发请求
    it('first response from backend, others from cache', done => {
      Promise.all([get('/2'), get('/2'), get('/2')]).then(result => {
        let arr = [];
        let now;
        result.forEach(res => {
          if (!now) {
            now = res.body.now;
          } else {
            assert.equal(res.body.now, now);
          }
          arr.push(res.get('x-hits'))
        });
        // TODO 从varnish中返回的缓存请求 x-hits都为2，后面查文档，有一次返回了0，1，2
        console.dir(arr);
        assert.equal(arr.sort().join(','), '0,2,2');
        done();
      }).catch(done);
    });

    // 缓存请求刚过期，在stale时效内请求，请求从缓存中读取，varnish并从backend中更新数据
    it('response from cache and fetch data from backend', function(done) {
      this.timeout(10 * 1000);
      let now;
      get('/3').then(res => {
        now = res.body.now;
        assert(res.text);
        assert.equal(res.get('x-hits'), '0');
        return delay(2000);
      }).then(() => {
        // 请求varnish，命中stale数据，varnish从backend更新
        return get('/3').then(res => {
          assert.equal(res.get('x-hits'), '1');
          assert.equal(res.body.now, now);
        });
      }).then(() => {
        // 所有请求都延时50ms，因此延时
        return delay(100);
      }).then(() => {
        const startedAt = Date.now();
        return get('/3').then(res => {
          assert.notEqual(res.body.now, now);
          // 由于是前一个请求更新的缓存，因此请求从缓存读取，耗时应该小于50ms
          assert(Date.now() - startedAt < 10);

          // TODO 是因为前一个请求生成的缓存，所以x-hits为1，后面查文档
          assert.equal(res.get('x-hits'), '1');
          done();
        });
      }).catch(done);
    });


    // 缓存已过期，则非在stale时间内请求，后面的两个并发请求都由backend返回
    it('response from backend', function(done) {
      this.timeout(10 * 1000);
      let now;
      get('/4').then(res => {
        now = res.body.now;
        assert(res.text);
        assert.equal(res.get('x-hits'), '0');
        return delay(5000);
      }).then(res => {
        return Promise.all([get('/4'), get('/4')]).then(result => {
          let arr = [];
          result.forEach(res => {
            arr.push(res.body.count);
            assert.notEqual(res.body.now, now);
            assert(res.text);
            assert.equal(res.get('x-hits'), '0');
          });
          // 返回的count证实的两个请求都到了后端
          assert.equal(arr.join(','), '2,3');
          done();
        });
      }).catch(done);
    });

  });
});