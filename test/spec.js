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

			remove = sinon.spy(function(query, callback) {
				callback();
			});

			action = sinon.spy(function(lock) {
				lock.release();
			});

			collection = {
				update: update,
				remove: remove,
				findAndModify: findAndModify
			};
		});

		describe('successful action', function() {
			beforeEach(function(done) {
				spinlock(collection)(action, done);
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

			it('calls remove', function() {
				assert(remove.called);
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
					spinlock({})();
				});
			});
		});

		describe('propagates error', function() {
			it('when update fails', function(done) {
				spinlock({
					update: function(query, operation, options, callback) {
						callback(new Error());
					}
				})(function() {
					throw new Error('Should not be called');
				}, function(err) {
					assert(err);
					done();
				});
			});

			it('when action fails', function(done) {
				spinlock(collection)(function(lock) {
					lock.release(new Error());
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
			acquire;

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
			acquire = spinlock(collection);
			collection.remove({}, done);
		});

		describe('successful action', function(done) {

			beforeEach(function(done) {
				acquire(function(lock) {
					lock.release();
				}, done);
			});

			it('removes locks', function(done) {
				collection.find({}).toArray(function(err, results) {
					if (err) {
						done(err);
						return;
					}

					results.should.have.lengthOf(0);
					done();
				});
			});

			it('can follow a timeout', function(done) {
				this.timeout(5000);
				this.slow(4000);

				acquire(function(outer) {
					acquire(function(inner) {
						inner.release();
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
					acquire(function(lock) {
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
						], lock.release);
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
