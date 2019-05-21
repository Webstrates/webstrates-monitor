'use strict';

const MongoClient = require('mongodb').MongoClient;
const ObjectID = require('mongodb').ObjectID;

const db = {};

const createObjectID = (date) => {
	if (!date) {
		throw new Error('No date specified');
	}
	if (typeof date === 'string') {
		date = new Date(date);
	}
	const hexSeconds = Math.floor(date/1000).toString(16);
	return ObjectID(hexSeconds + '0000000000000000');
};

MongoClient.connect(global.config.db, function(err, _db) {
	if (err)
		throw err;

	db.activities = _db.collection('monitorActivities');
	db.clients = _db.collection('monitorClients');
	//db.activities.ensureIndex({ webstrateId: 1 });
});

/**
 * Get all entries going back a certain amount of minutes.
 * @param  {Number} minutes Number of minutes to get history for.
 * @return {Array}          (async) Database entries.
 * @public
 */
db.getHistory = (userId, minutes) => {
	return new Promise((accept, reject) => {
		// We create a 'fake' ObjectID, so we can use search with this ObjectID as a timestamp.
		const fakeObjectID = createObjectID(new Date(Date.now() - 1000 * 60 * minutes));

		db.activities.find({ _id: { $gte: fakeObjectID } }).toArray((err, data) => {
			if (err) return reject(err);
			data.forEach(entry => entry.timestamp = ObjectID(entry._id).getTimestamp());
			accept(data);
		});
	});
};

db.getMonthData = (userId, date = new Date(), maxWebstrates = 20) => {
	return new Promise((accept, reject) => {
		const startDate = new Date(date);
		startDate.setDate(1);
		const endDate = new Date(startDate);
		endDate.setMonth(startDate.getMonth() + 1);

		const startDatefakeObjectID = createObjectID(startDate);
		const endDatefakeObjectID = createObjectID(endDate);
		console.log(endDate, endDatefakeObjectID);

		const query = { _id: { $gte: startDatefakeObjectID, $lt: endDatefakeObjectID  } };
		query['users.' + userId] = { $exists: true };
		console.log(JSON.stringify(query));
		db.activities.find(query).toArray((err, data) => {
			if (err) return reject(err);

			// This will be a map from dates to webstrateIds
			const dataDays = {};
			const webstrateActivity = new Map();

			data.forEach(x => {
				x.timestamp = ObjectID(x._id).getTimestamp();
				const day = x.timestamp.getDate();
				dataDays[day] = dataDays[day] || {};

				// Find the accumulated activity for a specific day.
				const activity = Object.values(x.users).reduce((sum, user) =>
					sum + user.signal + user.dom, 0);
				dataDays[day][x.webstrateId] = dataDays[day][x.webstrateId] || 0;
				dataDays[day][x.webstrateId] += activity;

				delete x.users;

				webstrateActivity.set(x.webstrateId,
					(webstrateActivity.get(x.webstrateId) || 0) + activity);
			});

			const topWebstrates = Array.from(webstrateActivity.entries())
				.sort(([ka, va], [kb, vb]) => vb - va)
				//.slice(0, maxWebstrates)
				.map(([webstrateId, activity]) => webstrateId);

			console.log(dataDays);

			Object.keys(dataDays).forEach(day => {
				Object.keys(dataDays[day]).forEach(webstrateId => {
					if (!topWebstrates.includes(webstrateId)) {
						delete dataDays[day][webstrateId];
					}
				});

				if (dataDays[day] && Object.keys(dataDays[day]).length === 0) {
					delete dataDays[day];
				}
			});

			//console.log(dataDays);

			accept(dataDays);
		});
	});
};

/**
 * Get all activities for a given interval in a webstrate.
 * @param  {string} webstrateIds List of WebstrateId.
 * @param  {Date} fromDate       From date.
 * @param  {Date} toTo           To Date.
 * @return {List}                (async) List of activities.
 */
db.getWebstrateActivities = (webstrateIds, fromDate, toDate = new Date()) => {
	return new Promise((accept, reject) => {
		if (!webstrateIds) return reject(new Error('No WebstrateIds specified'));

		const fromObjectID = createObjectID(fromDate);
		const toObjectID = createObjectID(toDate);

		db.clients.find({
			webstrateId: { $in: webstrateIds },
			_id: {
				$gt: fromObjectID,
				$lt: toObjectID
			} }).toArray((err, activities) => {
			if (err) return reject(err);
			const sortedActivities = {};
			activities.forEach((x) => {
				x.timestamp = new Date(ObjectID(x._id).getTimestamp());
				sortedActivities[x.webstrateId] = sortedActivities[x.webstrateId] || [];
				sortedActivities[x.webstrateId].push(x);
			});
			accept(sortedActivities);
		});
	});
};

db.getRecentUserActivity = (userId) => {
	return new Promise((accept, reject) => {
		db.clients.aggregate([
			{ $match: { userId: userId }, },
			{ $sort: {  "webstrateId": 1, _id: -1 } },
			{ $group: {
				originalId: { $first: '$_id' },
				_id: '$webstrateId',
			} },
			{ $project: {
					_id: '$originalId',
					webstrateId: '$_id'
			} }
		])
		.toArray(async (err, userActivity) => {
			if (err) return reject(err);
			let webstrateActivity = await getRecentWebstratesActivity(
				userActivity.map((x) => x.webstrateId),
				userId);

			userActivity.forEach((x) => {
				x.timestamp = new Date(ObjectID(x._id).getTimestamp());
			});
			userActivity.sort((x, y) => y.timestamp - x.timestamp);

			// Call getRecentWebstrateUsers(webstrateId) on each webstrate.
			const otherActivities = await Promise.all(userActivity.map((x) => {
				const THREE_HOURS = 3 * 60 * 60 * 1000;
				const beforeDate = new Date(x.timestamp + THREE_HOURS);
				const afterDate = new Date(x.timestamp - THREE_HOURS);
				return getRecentWebstrateUsers(x.webstrateId, beforeDate, afterDate);
			}));

			// Add other active users to the activity.
			userActivity.forEach((x, i) => {
				x.otherUsers = otherActivities[i];
			});

			webstrateActivity.forEach((x) => {
				x.timestamp = new Date(ObjectID(x._id).getTimestamp());
				const y = userActivity.find(y => y.webstrateId === x.webstrateId);
				x.userTimestamp = y.timestamp;
			});
			webstrateActivity.sort((x, y) => y.timestamp - x.timestamp);

			webstrateActivity = webstrateActivity.filter(x => {
				const minuteDifference = (x.timestamp - x.userTimestamp) / 60 * 1000;
				// Only include webstrates with activity that came more than 5 minutes after we edited
				// the document ourselves.
				return minuteDifference > 5;
			});

			//console.log(webstrateActivity);

			/*userActivity.forEach((activity) => {
				const other = webstrateActivity.find((other) =>
					other.webstrateId === activity.webstrateId);
				if (other) {
					activity.lastTimestamp = other.timestamp;
					activity.lastUserId = other.userId;
				}
			});*/

			accept({ userActivity, webstrateActivity });
		});
	});
};

/**
 * The the last activity from each webstrate listed. Only one activity per webstrate.
 * @param  {Array}  webstrateIds [description]
 * @param  {[type]} userId       [description]
 * @return {[type]}              [description]
 */
const getRecentWebstratesActivity = (webstrateIds = [], userId) => {
	return new Promise((accept, reject) => {
		db.clients.aggregate([
			{ $match: {
				webstrateId: { $in: webstrateIds },
				userId: { $ne: userId }
			} },
			{ $sort: {  "webstrateId": 1, _id: -1 } },
			{ $group: {
				originalId: { $first: '$_id' },
				_id: '$webstrateId',
				userId: { $first: '$userId' }
			} },
			{ $project: {
					_id: '$originalId',
					webstrateId: '$_id',
					userId: '$userId'
			} }
		])
		.toArray((err, webstrateActivity) => {
			if (err) return reject(err);
			webstrateActivity.forEach(entry => entry.timestamp = ObjectID(entry._id).getTimestamp());
			accept(webstrateActivity);
		});
	});
};

/**
 * Get a list of recent webstrate users in a webstrate.
 * @param  {string} webstrateId WebstrateId.
 * @param  {Date} beforeDate    Only include activities that happened before this date.
 * @param  {Date} afterDate     Only include activities that happened after this date.
 * @return {Array}              List of users active in the interval.
 * @private
 */
const getRecentWebstrateUsers = (webstrateId, beforeDate, afterDate) => {
	return new Promise((accept, reject) => {
		const beforeObjectID = createObjectID(beforeDate);
		const afterObjectID = createObjectID(afterDate);
		db.clients.distinct('userId', {
			webstrateId: webstrateId,
			_id: { $lt: beforeObjectID, $gt: afterObjectID }
		}, (err, activities) => {
			if (err) return reject(err);
			accept(activities);
		});
	});
}

module.exports = db;