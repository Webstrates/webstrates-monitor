const db = require('./database.js');

const messageHandler = {};

const activeDocuments = new Map();

messageHandler.handle = (data) => {
	const webstrateId = data.webstrateId;
	const userId = data.userId;

	if (!webstrateId || !userId) return;

	if (!activeDocuments.has(webstrateId)) {
		activeDocuments.set(webstrateId, new Map());
	}
	const users = activeDocuments.get(webstrateId);

	switch (data.ga) {
		case 'dom':
		case 'signal': {
			if (!users.has(userId)) {
				users.set(userId, { dom: 0, signal: 0 });
			}
			const userObj = users.get(userId);
			userObj[data.ga]++;
			break;
		}

		case 'clientJoin':
		case 'clientPart': {
			db.clients.insert({ type: data.ga, webstrateId, userId });
			break;
		}
	}
};

/**
 * This loop runs once a minute (should be as defined in config) and updates the database
 * with all activity that has happened in the last minute, in particular the number of ops/signals
 * to each webstrate in the interval.
 */
setInterval(() => {
	const mongoEntries = Array.from(activeDocuments)
		.filter(([webstrateId, users]) => users.size > 0)
		.map(([webstrateId, users]) => ({ webstrateId, users }));

	activeDocuments.clear();

	if (mongoEntries.length > 0) {
		db.activities.insertMany(mongoEntries);
	}
}, 60 * 1000);

module.exports = messageHandler;

function cloneObject(obj) {
	return JSON.parse(JSON.stringify(obj));
}