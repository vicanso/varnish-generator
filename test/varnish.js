'use strict';
const assert = require('assert');
const varnishGenerator = require('..');
const request = require('superagent');
const _ = require('lodash');

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

function startServer() {
  require('./support/varnish');
  return delay(5 * 1000);
}


describe('varnish', () => {
  describe('cacheable', () => {

    it('start server', function(done) {
      this.timeout(15 * 1000);
      startServer().then(done);
    });

    // 可缓存请求，首次无缓存时，从backend中获取数据
    it('response from backend success (/1)', done => {
      get('/1').then(res => {
        assert(res.text);
        assert.equal(res.get('x-hits'), '0');
        done();
      }).catch(done);
    });

    // 可缓存请求，已有缓存，从缓存中读取
    it('response from cache success (/1)', done => {
      get('/1').then(res => {
        assert(res.text);
        assert.equal(res.get('x-hits'), '1');
        done();
      }).catch(done);
    });

    // 可缓存请求，无缓存，多请求并发请求，一个请求从backend获取，其它的使用第一个请求的缓存（varnish返回的请求顺序不一）
    it('first response from backend, others from cache (/2)', done => {
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

    // 可缓存请求，缓存请求刚过期，在stale时效内请求，请求从缓存中读取，varnish并从backend中更新数据
    it('response from cache and fetch data from backend (/3)', function(done) {
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


    // 可缓存请求，缓存已过期，且非在stale时间内请求，后面的两个并发请求都由backend返回
    it('response from backend (/4)', function(done) {
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
          assert.equal(arr.sort().join(','), '2,3');
          done();
        });
      }).catch(done);
    });

    // 不可缓存请求，首次请求，从backend中获取数据
    it('response from backend (/5)', done => {
      let now;
      get('/5').then(res => {
        now = res.body.now;
        assert(res.text);
        assert.equal(res.get('x-hits'), '0');
        return get('/5');
      }).then(res => {
        assert(res.text);
        assert.equal(res.get('x-hits'), '0');
        assert.notEqual(res.body.now, now);
        done();
      }).catch(done);
    });

    // 不可缓存请求，多请求并发请求，第一个请求从backend读取，后续请求等第一个请求返回再从backend读取
    it('response from backend (/6)', done => {
      Promise.all([get('/6'), get('/6'), get('/6')]).then(result => {
        result = _.sortBy(result, res => res.body.count);
        let now;
        // 第1个请求从backend获取，第2，3个请求等第1个返回再从backend获取
        result.forEach((res, i) => {
          if (now) {
            if (i === 1) {
              assert(res.body.now - now > 50);
            } else {
              assert(res.body.now - now < 5);
            }
          }
          now = res.body.now;
        });
        done();
      }).catch(done);
    });

    // 不可缓存请求，已缓存（hit-for-pass），请求从backend读取
    it('response from backend (/7)', done => {
      let now;
      get('/7').then(res => {
        now = res.body.now;
        assert(res.text);
        assert.equal(res.get('x-hits'), '0');
        assert.equal(res.body.count, 1);
        return get('/7');
      }).then(res => {
        assert(res.text);
        assert(res.body.now - now > 50 && res.body.now - now < 60);
        assert.equal(res.get('x-hits'), '0');
        assert.equal(res.body.count, 2);
        done();
      }).catch(done);
    });

    // 不可缓存请求，缓存已过期（hit-for-pass），请求从backend读取
    it('response from backend (/8)', function(done) {
      this.timeout(10 * 1000);
      get('/8').then(res => {
        assert(res.text);
        assert.equal(res.get('x-hits'), '0');
        assert.equal(res.body.count, 1);
        return delay(5 * 1000);
      }).then(() => {
        return Promise.all([get('/8'), get('/8')]);
      }).then(result => {
        result = _.sortBy(result, res => res.body.count);
        _.forEach(result, (res, i) => {
          assert(res.text);
          assert.equal(res.get('x-hits'), '0');
          assert.equal(res.body.count, i + 2);
        });
        assert(result[0].res.body.now - result[1].res.body.now < 5);
        done();
      }).catch(done);
    });
  });
});