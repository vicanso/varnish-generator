'use strict';
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const varnishGenerator = require('..');
const backends = require('../backends');
const instance = 'varnish-test';

const backendConfig = 'backend timtam0{\n  .host = "127.0.0.1";\n  .port = "3000";\n  .connect_timeout = 3s;\n  .first_byte_timeout = 10s;\n  .between_bytes_timeout = 2s;\n  .probe = {\n    .url = "/ping";\n    .interval = 3s;\n    .timeout = 5s;\n    .window = 5;\n    .threshold = 3;\n  }\n}\nbackend timtam1{\n  .host = "127.0.0.1";\n  .port = "3010";\n  .connect_timeout = 3s;\n  .first_byte_timeout = 10s;\n  .between_bytes_timeout = 2s;\n  .probe = {\n    .url = "/ping";\n    .interval = 3s;\n    .timeout = 5s;\n    .window = 5;\n    .threshold = 3;\n  }\n}\nbackend albi0{\n  .host = "127.0.0.1";\n  .port = "3020";\n  .connect_timeout = 3s;\n  .first_byte_timeout = 10s;\n  .between_bytes_timeout = 2s;\n  .probe = {\n    .url = "/ping";\n    .interval = 3s;\n    .timeout = 5s;\n    .window = 5;\n    .threshold = 3;\n  }\n}\nbackend albi1{\n  .host = "127.0.0.1";\n  .port = "3030";\n  .connect_timeout = 3s;\n  .first_byte_timeout = 10s;\n  .between_bytes_timeout = 2s;\n  .probe = {\n    .url = "/ping";\n    .interval = 3s;\n    .timeout = 5s;\n    .window = 5;\n    .threshold = 3;\n  }\n}';
const initConfig = 'sub vcl_init{\n  new timtam = directors.random();\n  timtam.add_backend(timtam0, 1)\n  timtam.add_backend(timtam1, 1)\n  new albi = directors.random();\n  albi.add_backend(albi0, 1)\n  albi.add_backend(albi1, 1)\n}';
const selectConfig = '  if(req.http.host == "black" && req.url ~ "/timtam"){\n    set req.backend_hint = timtam.backend();\n  }elsif(req.http.host == "white" && req.url ~ "/albi"){\n    set req.backend_hint = albi.backend();\n  }';


describe('varnish-generator', () => {
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
		varnishGenerator.getConfig(backends).then(config => {
			config.name = instance;
			return varnishGenerator.getVcl(config);
		}).then(vcl => {
			fs.writeFile(path.join(__dirname, '../default.vcl'), vcl, done);
		}).catch(done);
	});
});