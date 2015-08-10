var _ = require('lodash'),
	async = require('async'),
	uuid = require('uuid'),
	Moment = require('moment');

module.exports = function(options, done) {
	options = options || {};

	var collection = options.collection;
	var action = options.action;

	if (collection === undefined) {
		throw new Error('Must provide a mongo collection for operatinog on');
	}

	if (typeof action !== 'function') {
		throw new Error('Must provide an action to perform');
	}

	var ttl = options.ttl || 2;
	var field = options.field || 'lock';

	var query = _.assign({ $isolated: 1 }, options.filter || {});
	var completed = options.complete || { complete: true };

	var lock = {
		id: uuid.v4(),
		exp: new Moment().add(ttl, 'seconds').toDate()
	};

	var fieldId = field + '.id';
	var field$Exp = field + '.$.exp';
	var field0Id = field + '.0.id';

	var all = _.assign({}, query);
	all[fieldId] = lock.id;

	var ready = _.assign({}, query);
	ready[field0Id] = lock.id;

	function refresh(callback) {
		var increasedExpiryTime = {};

		increasedExpiryTime[field$Exp] = new Moment().add(ttl, 'seconds').toDate();

		collection.update(all, { $set: increasedExpiryTime }, { multi: true }, callback);
	}

	function remove(callback) {
		var expiredOrCompleted = {};

		expiredOrCompleted[field] = { $or: [{ exp: { $lt: new Moment().toDate() } }, completed] };

		collection.update(query, { $pull: expiredOrCompleted }, { multi: true }, callback);
	}

	function attempt() {
		async.forever(function(attemptAgain) {
			async.series([
				refresh,
				function(next) {
					action({
						all: all,
						ready: ready
					}, next);
				},
				remove
				], function(err) {
					if (err) {
						done(err);
						return;
					}

					collection.count(all, function(err, result) {
						if (err || result === 0) {
							done(err);
							return;
						}

						attemptAgain();
					});
				});
		});
	}

	var newLock = {};
	newLock[field] = lock;

	collection.update(query, { $push: newLock }, { multi: true }, function(err) {
		if (err) {
			done(err);
			return;
		}

		attempt();
	});
};
