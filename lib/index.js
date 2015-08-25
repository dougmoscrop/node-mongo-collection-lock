var async = require('async'),
	uuid = require('uuid'),
	Moment = require('moment');

module.exports = function(collection, options) {
	if (collection === undefined) {
		throw new Error('Must provide a mongo collection for storing locks');
	}

	options = options || {};

	var id = options.id || 'default';
	var ttl = options.ttl || 1;

	return {
		acquire: function attempt(action, done) {
			if (typeof action !== 'function') {
				throw new Error('Must specify a function to call as an action');
			}

			var key = uuid.v4();

			// Ensure the lock-record exists
			collection.update({ _id: id }, { $setOnInsert: { _id: id } }, { upsert: true, w: 1 }, function(err) {
				if (err && err.code !== 11000) {
					done(err);
					return;
				}

				var myLock = { _id: id, key: key };
				var freeLock = { _id: id, key: { $exists: false } };

				var attempts = 1;

				async.forever(function(attemptAgain) {
					async.waterfall([
						function releaseExpired(next) {
							var expired = { _id: id, expires: { $lt: new Moment().toDate() } };

							collection.update(expired, { $unset: { key: true } }, { w: 1 }, function(err) {
								next(err);
							});
						},
						function acquireLock(next) {
							var lock = {
								_id: id,
								key: key,
								expires: new Moment().add(ttl, 'seconds').toDate(),
								acquired: new Moment().toDate()
							};

							collection.findAndModify(freeLock, undefined, lock, { new: true, w: 1 }, function(err, result) {
								next(err, result && result.value);
							});
						},
						function(lock, next) {
							if (lock) {
								action(
									function release(err) {
										collection.update(myLock, { $set: { lastKey: lock.key }, $unset: { key: true } }, { w: 1 }, function() {
											next(err);
										});
									},
									function refresh(callback) {
										var increaseExpiryTime = { $set: { expires: new Moment().add(ttl, 'seconds').toDate() } };

										collection.update(myLock, increaseExpiryTime, { w: 1 }, callback);
									}
								);
							} else {
								attempts++;
								attemptAgain();
							}
						}
					], done);
				});
			});
		}
	};
};
