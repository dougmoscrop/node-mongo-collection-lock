# mongo-spinlock
[![Circle CI](https://circleci.com/gh/dougmoscrop/node-mongodb-spinlock.svg?style=svg)](https://circleci.com/gh/dougmoscrop/node-mongodb-spinlock)
[![Coverage Status](https://coveralls.io/repos/dougmoscrop/node-mongodb-spinlock/badge.svg?branch=master&service=github)](https://coveralls.io/github/dougmoscrop/node-mongodb-spinlock?branch=master)

```javascript
var spinlock = require('mongodb-spinlock');

var lock = spinlock(collection, { ttl: 1, id: 'default' });

lock.acquire(function(release, renew) {
	doSomethingAsync(function(err) {
		if (err) {
			release(err);
			return;
		}

		// extend the expiry time
		renew(function(err) {
			doSomethingElseAsync(release);
		});
	});
}, function done(err) {
	// either your operation is done and the lock is released or an error happened, either because an err was passed to release,
	// or an internal error e.g. database problem updating the lock
});
```
