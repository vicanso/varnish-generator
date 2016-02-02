'use strict';
const express = require('express');
const fs = require('fs');
const path = require('path');

module.exports = createServer(3000, '/timtam');

/**
 * [createServer description]
 * @param  {[type]} port   [description]
 * @param  {[type]} prefix [description]
 * @return {[type]}        [description]
 */
function createServer(port, prefix) {
	const app = express();
	app.use((req, res, next) => {
		res.set('Cache-Control', 'no-cache');
		next();
	});

	if (prefix) {
		app.use((req, res, next) => {
			if (req.originalUrl.indexOf(prefix) === 0) {
				req.originalUrl = req.originalUrl.substring(prefix.length) || '/';
				req.url = req.originalUrl;
			}
			next();
		});
	}

	app.get('/ping', (req, res) => {
		res.send('pong');
	});

	app.get('/headers', (req, res) => {
		res.set('Cache-Control', 'public, max-age=1');
		res.json(req.headers);
	});

	app.get('/gzip', (req, res) => {
		res.set('Cache-Control', 'public, max-age=120');
		fs.readFile(path.join(__dirname, './koa.txt'), 'utf-8', (err, data) => {
			res.send(data);
		});
	});

	app.get('/cacheable', (req, res) => {
		res.set('Cache-Control', 'public, max-age=120');
		res.json({
			msg: 'cache',
			date: Date.now()
		});
	});

	app.get('/max-age/:ttl', (req, res) => {
		const ttl = req.params.ttl;
		setTimeout(function() {
			res.set('Cache-Control', `public, max-age=${ttl}`);
			res.json({
				msg: `max-age=${ttl}`,
				date: Date.now()
			});
		}, 1200);
	});

	app.get('/cache-control/:v', (req, res) => {
		const v = req.params.v;
		setTimeout(function() {
			res.set('Cache-Control', v);
			res.json({
				msg: `Cache-Control:${v}`
			});
		}, 1200);
	});

	app.get('/set-cookie', (req, res) => {
		res.cookie('vicanso', 'my-test');
		setTimeout(function() {
			res.json({
				msg: 'set-cookie'
			});
		}, 1200);
	});

	app.all('/method', (req, res) => {
		res.set('Cache-Control', 'public, max-age=120');
		res.json({
			msg: 'success',
			date: Date.now()
		});
	});

	app.get('/keep', (req, res) => {
		res.set('Cache-Control', 'public, max-age=1');
		res.json(req.headers);
	});

	app.get('/304', (req, res) => {
		const etag = 'W/"2f26-N4gKPDCCU6VknUpW3vrT3w"';
		if (req.get('If-None-Match') === 'W/"2f26-N4gKPDCCU6VknUpW3vrT3w"') {
			res.status(304).end();
		} else {
			res.set('ETag', etag).end('test-data');
		}
	});

	return app.listen(port, () => {
		console.info(`listen on:${port}`);
	});
}