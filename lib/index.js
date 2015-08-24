var async = require('async'),
	uuid = require('uuid'),
	Moment = require('moment');

module.exports = function(collection, options) {
	options = options || {};

	if (collection === undefined) {
		throw new Error('Must provide a mongo collection for storing locks');
	}

	var ttl = options.ttl || 1;
	var name = options.name || 'lock';

	return function attempt(action, done) {
		if (typeof action !== 'function') {
			throw new Error('Must specify a function to call as an action');
		}

		var holder = uuid.v4();
		var attempts = 1;

		async.forever(function(attemptAgain) {
			async.waterfall([
				function releaseExpired(next) {
					var expired = { name: name, expires: { $lt: new Moment().toDate() } };

					collection.update(expired, { $unset: { holder: true } }, {}, function(err) {
						next(err);
					});
				},
				function acquireLock(next) {
					var lock = {
						name: name,
						holder: holder,
						created: new Moment().toDate(),
						expires: new Moment().add(ttl, 'seconds').toDate()
					};

					collection.update({ name: name }, { $set: { name: name } }, { upsert: true, new: true }, function(err, result) {
						if (err) {
							next(err);
							return;
						}

						collection.findAndModify({ name: name, holder: { $exists: false } }, undefined, lock, { new: true }, function(err, result) {
							next(err, result && result.value);
						});
					});
				},
				function(lock, next) {
					if (lock) {
						action({
							_attempts: attempts,
							_key: holder,
							refresh: function refresh(callback) {
								var increaseExpiryTime = { $set: { expires: new Moment().add(ttl, 'seconds').toDate() } };

								collection.update({ name: name, holder: lock.holder }, increaseExpiryTime, {}, callback);
							},
							release: function(err) {
								collection.remove({ name: name, holder: lock.holder }, function() {
									next(err);
								});
							}
						});
					} else {
						attempts++;
						attemptAgain();
					}
				}
			], done);
		});
	};
};
