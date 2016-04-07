'use strict';
const assert = require('assert');
const varnishGenerator = require('..');
const varnishConfig = require('../config.json');
const backends = varnishConfig.backends;
const fs = require('fs');
const path = require('path');

const backendConfig =
  'backend albi0{\n  .host = "127.0.0.1";\n  .port = "3020";\n  .connect_timeout = 3s;\n  .first_byte_timeout = 10s;\n  .between_bytes_timeout = 2s;\n  .probe = {\n    .url = "/ping";\n    .interval = 3s;\n    .timeout = 5s;\n    .window = 5;\n    .threshold = 3;\n  }\n}\nbackend albi1{\n  .host = "127.0.0.1";\n  .port = "3030";\n  .connect_timeout = 3s;\n  .first_byte_timeout = 10s;\n  .between_bytes_timeout = 2s;\n  .probe = {\n    .url = "/ping";\n    .interval = 3s;\n    .timeout = 5s;\n    .window = 5;\n    .threshold = 3;\n  }\n}\nbackend timtam0{\n  .host = "127.0.0.1";\n  .port = "3000";\n  .connect_timeout = 3s;\n  .first_byte_timeout = 10s;\n  .between_bytes_timeout = 2s;\n  .probe = {\n    .url = "/ping";\n    .interval = 3s;\n    .timeout = 5s;\n    .window = 5;\n    .threshold = 3;\n  }\n}\nbackend timtam1{\n  .host = "127.0.0.1";\n  .port = "3010";\n  .connect_timeout = 3s;\n  .first_byte_timeout = 10s;\n  .between_bytes_timeout = 2s;\n  .probe = {\n    .url = "/ping";\n    .interval = 3s;\n    .timeout = 5s;\n    .window = 5;\n    .threshold = 3;\n  }\n}\nbackend defaultBackend0{\n  .host = "127.0.0.1";\n  .port = "3040";\n  .connect_timeout = 3s;\n  .first_byte_timeout = 10s;\n  .between_bytes_timeout = 2s;\n  .probe = {\n    .url = "/ping";\n    .interval = 3s;\n    .timeout = 5s;\n    .window = 5;\n    .threshold = 3;\n  }\n}';
const initConfig =
  'sub vcl_init{\n  new albi = directors.random();\n  albi.add_backend(albi0, 1);\n  albi.add_backend(albi1, 1);\n  new timtam = directors.random();\n  timtam.add_backend(timtam0, 1);\n  timtam.add_backend(timtam1, 1);\n  new defaultBackend = directors.random();\n  defaultBackend.add_backend(defaultBackend0, 1);\n}';
const selectConfig =
  '  set req.backend_hint = defaultBackend.backend();\n  if(req.http.host == "white" && req.url ~ "^/albi"){\n    set req.backend_hint = albi.backend();\n  }elsif(req.url ~ "^/timtam"){\n    set req.backend_hint = timtam.backend();\n  }';


describe('varnish-config', () => {
  it('should get backend config success', done => {
    varnishGenerator.getBackendConfig(backends).then(result => {
      assert.equal(result, backendConfig);
      done();
    }).catch(done);
  });
  

  it('should get init config success', done => {
    varnishGenerator.getInitConfig(backends).then(result => {
      assert.equal(result, initConfig);
      done();
    }).catch(done);
  });


  it('should get backend select config success', () => {
    const result = varnishGenerator.getBackendSelectConfig(backends);
    assert.equal(selectConfig, result);
  });


  it('should get varnish config success', done => {
    varnishGenerator.getConfig(backends).then(result => {
      assert.equal(result.backendConfig, backendConfig);
      assert.equal(result.initConfig, initConfig);
      assert.equal(result.selectConfig, selectConfig);
      done();
    }).catch(done);
  });

  it('should get vcl file success', done => {
    // stale 缓存过期之后多长时间还可用
    // keep 缓存过期之后，数据在多长时间可用于 If-Modified-Since / If-None-Match
    // grace 缓存过期多长数据被删除（用于在所有backend都出问题时返回）
    // backends backend列表
    // name varnish实例名称（用于区分不同的varnish实例）
    // version 版本号（用来标记vcl file）
    varnishGenerator.getVcl(varnishConfig).then(vcl => {
      fs.writeFile(path.join(__dirname, '../default.vcl'), vcl, done);
    }).catch(done);
  });
});