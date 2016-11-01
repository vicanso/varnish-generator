'use strict';
const assert = require('assert');
const varnishGenerator = require('..');
const request = require('superagent');
const _ = require('lodash');
const server = require('./support/server');

process.on('beforeExit', () => {
  server.close();
});

function get(url) {
  return request.get(`http://127.0.0.1:8001${url}`);
}

function post(url, data) {
  return request.post(`http://127.0.0.1:8001${url}`)
    .send(data);
}

function delay(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

function startServer() {
  return delay(10 * 1000);
}


describe('varnish', () => {
  describe('cacheable', () => {

    it('start server', function(done) {
      this.timeout(15 * 1000);
      startServer().then(done);
    });
    // the first request, there is no cache
    it('get cacheable from backend success', (done) => {
      get('/cache/max-age/10').then((res) => {
        assert.equal(res.text, 'Hello World');
        assert.equal(res.get('X-Hits'), '0');
        done();
      }).catch(done);
    });

    // the second request will be response from cache
    it('get cacheable from cache success', (done) => {
      get('/cache/max-age/10').then((res) => {
        assert.equal(res.text, 'Hello World');
        assert.equal(res.get('X-Hits'), '1');
        done();
      }).catch(done);
    });


    // set request Cache-Control:no-cache will be pass
    it('Cache-Control:no-cache will pass to backend', (done) => {
      get('/cache/max-age/10')
        .set('Cache-Control', 'no-cache')
        .then((res) => {
          assert.equal(res.text, 'Hello World');
          assert.equal(res.get('X-Hits'), '0');
          done();
        }).catch(done);
    });

    // the post request will be pass
    it('post request will pass to backend', (done) => {
      post('/post', {}).then((res) => {
        assert.equal(res.text, '{}');
        assert.equal(res.get('X-Hits'), '0');
        done();
      }).catch(done);
    });

    // response with no-cache will be hit for pass
    it('get no-cache from backend', (done) => {
      const check = (res) => {
        assert.equal(res.get('Cache-Control'), 'public, no-cache');
        assert.equal(res.text, 'Hello World');
        assert.equal(res.get('X-Hits'), '0');
      };
      get('/no-cache').then((res) => {
        check(res);
        return get('/no-cache');
      }).then((res) => {
        check(res);
        done();
      }).catch(done);
    });

    // http status code is not `202、203、204、300、301、302、304、307、404、410、414`, the response will be uncacheable
    it('400 response will no cache even if there is max-age', (done) => {
      const check = (res) => {
        return get('/400').then(() => {
          done(new Error('It will return 404'));
        }).catch((err) => {
          const res = err.response;
          assert.equal(res.get('Cache-Control'), 'public, max-age=10');
          assert.equal(res.text, 'Hello World');
          assert.equal(res.get('X-Hits'), '0');
        });
      };
      check().then(() => {
        return check();
      }).then(done).catch(done);
    });
  });
});