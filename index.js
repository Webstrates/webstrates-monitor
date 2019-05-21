//const express = require('express');
//const expressWs = require('express-ws');
const WebSocket = require('ws');
const ObjectId = require('mongodb').ObjectId;
const fss = require('fs-sync');

const config = global.config = fss.readJSON('config.json');
const db = require('./database.js');
const messageHandler = require('./messageHandler');

const godSocket = new WebSocket('ws://localhost:7007/@monitor?noop');
const subscriptionId = Math.random().toString(36).substring(2);

process.on('unhandledRejection', r => console.log(r));

// Authorize ourselves with the server.
godSocket.on('open', () => {
	console.log('Connected to server');
	godSocket.send(JSON.stringify({
		ga: 'key',
		key: config.godApiKey
	}));

	// Websocket will automatically close after 30 seconds of inactivity. Send keep alive message every 25 seconds.
	setInterval(() => {
		godSocket.send(JSON.stringify({ type: 'alive' }));
	}, 25 * 1000)
});

// Listen for messages from the server
godSocket.on('message', data => {
	data = JSON.parse(data);

	if (data.ga === 'unauthorized') {
		console.log('Unauthorized');
		return;
	}

	if (data.ga === 'authorized') {
		console.log('Authorized');
		godSocket.send(JSON.stringify({
			ga: 'subscribeWebstrate',
			webstrates: '*',
			subscriptionId
		}));
		return;
	}

	messageHandler.handle(data);
});

godSocket.on('error', () => {
	process.exit(1);
});

// Just close for now, so forever will restart.
godSocket.on('close', () => {
	console.error('Lost connection, restarting application');
	process.exit(1);
});

const server = new WebSocket.Server({
	port: 7009,
});

function send(client, msg) {
	if (typeof msg === 'object') msg = JSON.stringify(msg);

	try {
		client.send(msg);
	} catch (e) {
		console.error(e);
		allClients.delete(client);
		liveClients.delete(client);
	}
}

const allClients = new Set(); // All Clients
const liveClients = new Set(); // A subset of allClients, clients subscribing to real-time data.
server.on('connection', client => {
	client.on('message', async msg=> {
		try {
			msg = JSON.parse(msg);
		} catch (error) {
			send(client, { error: 'Unable to parse JSON' });
			return;
		}

		msg.options = msg.options || {};
		const userId = msg.userId || 'anonymous:';

		// We may be injecting userId into a query, so we want to sanitize it beforehand.
		if (!userId.match(/^[\w]{2,40}:[\w]{0,15}$/)) {
			send(client, { request: msg.request, error: 'Invalid userId'});
			return;
		}

		/*if (msg.subscribe === 'live') {
			liveClients.add(client);
			send(client, { init: 1, data: msgHandler.getDomHistory() });
		}*/

		/*if (msg.type === 'history') {
			const data = await db.getHistory(userId, msg.minutes);
			send(client, { month: 1, data: data });
		}*/

		else if (msg.type === 'month') {
			const now = new Date();
			const year = msg.options.year || (now.getFullYear());
			const month = msg.options.month || (now.getMonth() + 1);
			const date = new Date(year, month - 1);
			const data = await db.getMonthData(userId, date, Number(msg.options.maxWebstrates));
			send(client, { token: msg.token, payload: data });
		}

		/*else if (msg.type === 'webstrates') {
			const data = await db.getRecentUserActivity(userId);
			send(client, { webstrates: 1, data });
		}*/

		else if (msg.type === 'activities') {
			// API accepts a list of webstrates, but we only want one...
			const webstrateIds = [ msg.options.webstrateId ];
			const fromDate = msg.options.fromDate && new Date(msg.options.fromDate);
			const toDate = msg.options.toDate && new Date(msg.options.toDate);
			if (webstrateIds && fromDate && toDate) {
				const data = await db.getWebstrateActivities(webstrateIds, fromDate, toDate);
				send(client, { token: msg.token, payload: data });
			}
			else {
				send(client, { token: msg.token, error: 'Missing input '});
			}
		}

	});
	allClients.add(client);
});

server.on('close', client => {
	allClients.delete(client);
	liveClients.delete(client); // client might not be in liveClients
});