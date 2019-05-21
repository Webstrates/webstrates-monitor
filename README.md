# webstrates-monitor

Webstrates Monitor is a service that attaches to the
[Webstrates God API](https://webstrates.github.io/userguide/god-api.html) and builds a MongoDB-based activity database
based on the real-time data received, which applications may then query for historical data.

The collected data will be stored in the MongoDB collections `monitorActivities` and `monitorClients`.

Every minute of activity, an object will be inserted into `monitorActivities` containing the `webstrateId` the activity
happened in, and a list of users that partook in the activity. For each user, the number of DOM modification and signals
will be performed -- not the actual signals or DOM modification, just the count.

Every time a user joins or parts a webstrate, this is logged into `monitorClients`.

## Querying data

To query the data, a websocket connection has to be established to the Webstrates Monitor. All communication to the
server will happen across this connection through JSON objects.

It's possible to query for either all joins/parts of a specific webstrate or for a user's activities (DOM changes and
signals) across all webstrates.

To get the join/part history of a webstrate, a request must be sent including the webstrateId, a date range and an
optional token, for instance:

```json
{
  "type": "activities",
  "options": {
    "webstrateId": "frontpage",
    "fromDate": "2018-12-24",
    "toDate": "2019-01-01",
  },
  "token": "qgbe4glavvb"
}
```

The above request will cause the server to reply with a list of all joins/parts in the webstrate `frontpage` within
the given data interval.

When setting a token, the server will return the reply with the same token. Using a random token for each request will
make it easy to establish request-response pairings.

To query for a user's activities, the "month" type can be used:

```json
{
  "type": "month",
  "options": {
    "month": 5,
    "year": 2019,
    "maxWebstrates": "20"
  },
  "userId": "kbadk:github",
  "token": "2kba5isn1c3"
}
```

The above request will cause the server to reply with an object of days (1-31) of the requested month and year. (Only
days with activites will be in the map). These days will then each map to another object with webstrateIds as keys and
activity count as values (i.e. the number of signals + DOM changes).

There is no authentication as of right now, which there probably should be.

Sidenote: To prevent the websocket connection timing out, send a `{ type: 'ping' }` message over the websocket every 25
seconds or so if you intend to perform more requests.

## Installation

Clone this repository, do `npm install`, then create a `config.json` file containing the following

```json
{
  "db": "mongodb://localhost:27017/webstrate",
  "godApiKey": "<godApiKey as defined by the Webstrates server config>"
}
```

The `godApiKey` must be the same as
[defined in the Webstrates server config](https://webstrates.github.io/userguide/server-config.html#god-api).