var assert = require('assert'),
	async = require('async'),
	MongoClient = require('mongodb').MongoClient,
	sinon = require('sinon'),
	spinlock = require('../lib');

require('should');

describe('spinlock', function() {
	describe('unit', function() {
		var collection, update, findAndModify, remove, action;

		beforeEach(function() {
			update = sinon.spy(function(query, operation, options, callback) {
				callback();
			});

			findAndModify = sinon.spy(function(query, sort, operation, options, callback) {
				callback(null, { value: operation });
			});

			action = sinon.spy(function(release) {
				release();
			});

			collection = {
				update: update,
				remove: remove,
				findAndModify: findAndModify
			};
		});

		describe('successful action', function() {
			beforeEach(function(done) {
				spinlock(collection).acquire(action, done);
			});

			it('gets called', function() {
				assert(action.called);
			});

			it('calls update', function() {
				assert(update.called);
			});

			it('calls findAndModify', function() {
				assert(findAndModify.called);
			});

			it('passes a lock to the action', function() {
				assert(action.firstCall.args[0] !== undefined);
			});
		});

		describe('throws when', function() {
			it('missing collection', function() {
				assert.throws(function() {
					spinlock();
				});
			});

			it('missing action', function() {
				assert.throws(function() {
					spinlock({}).acquire();
				});
			});
		});

		describe('propagates error', function() {
			it('when update fails', function(done) {
				spinlock({
					update: function(query, operation, options, callback) {
						callback(new Error());
					}
				}).acquire(function() {
					throw new Error('Should not be called');
				}, function(err) {
					assert(err);
					done();
				});
			});

			it('when action fails', function(done) {
				spinlock(collection).acquire(function(release) {
					release(new Error());
				}, function(err) {
					assert(err);
					done();
				});
			});
		});
	});

	(process.env.CI ? describe : describe.skip)('integration', function() {
		var url = 'mongodb://127.0.0.1:27017/test',
			db,
			collection,
			otherCollection,
			lock;

		before(function(done) {
			MongoClient.connect(url, function(err, db) {
				if (err) {
					done(err);
					return;
				}

				db = db;
				collection = db.collection('collection_lock');
				otherCollection = db.collection('test_data');
				done();
			});
		});

		after(function(done) {
			if (db) {
				db.close();
			}

			done();
		});

		beforeEach(function(done) {
			lock = spinlock(collection);
			collection.remove({}, done);
		});

		describe('successful action', function(done) {

			beforeEach(function(done) {
				lock.acquire(function(release) {
					release();
				}, done);
			});

			it('has no keys in locks', function(done) {
				collection.find({}).toArray(function(err, results) {
					if (err) {
						done(err);
						return;
					}

					assert(results.every(function(result) {
						return result.key === undefined;
					}));

					done();
				});
			});

			it('can follow a timeout', function(done) {
				this.timeout(5000);
				this.slow(4000);

				lock.acquire(function() {
					lock.acquire(function(release) {
						release();
					}, done);
				}, function() {
					throw new Error('Should not be called');
				});
			});
		});

		describe('concurrent sitaution', function() {
			this.slow(1500);

			it('update is uniform', function(done) {
				async.map(['foo', 'bar', 'baz', 'foobar', 'blah', 'many', 'doge', 'mongo'], function(term, callback) {
					lock.acquire(function(release) {
						var query = { $isolated: 1 };

						async.series([
							function(_next) {
								setTimeout(function() {
									otherCollection.update(query, { $set: { first: term } }, { upsert: true, multi: true }, _next);
								}, Math.floor((Math.random() * 50) + 1));
							},
							function(_next) {
								setTimeout(function() {
									otherCollection.update(query, { $set: { second: term } }, { upsert: true, multi: true }, _next);
								}, Math.floor((Math.random() * 50) + 1));
							}
						], release);
					}, callback);
				}, function(err) {
					if (err) {
						done(err);
						return;
					}

					otherCollection.find({}).toArray(function(err, results) {
						if (err) {
							done(err);
							return;
						}

						assert(results.length > 0);

						assert(results.every(function(result) {
							return result.first === result.second;
						}));

						assert(results.every(function(result) {
							return result.first === results[0].first;
						}));

						done();
					});
				});
			});
		});
	});
});
