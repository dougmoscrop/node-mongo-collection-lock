var assert = require('assert'),
	async = require('async'),
	MongoClient = require('mongodb').MongoClient,
	sinon = require('sinon'),
	spinlock = require('../lib');

require('should');

describe('spinlock', function() {
	describe('unit', function() {
		var iterations = 2;
		var count, update, action;

		beforeEach(function(done) {
			var result = iterations - 1;

			update = sinon.spy(function(query, operation, options, callback) {
				callback();
			});

			count = sinon.spy(function(query, callback) {
				callback(null, result--);
			});

			action = sinon.spy(function(id, next) {
				next();
			});

			var collection = {
				update: update,
				count: count
			};

			spinlock(collection, {
				try: action
			}, done);
		});

		it('should call action each time', function() {
			assert(action.callCount === iterations);
		});

		it('should call count each time', function() {
			assert(count.callCount === iterations);
		});

		it('should call update', function() {
			assert(update.called);
		});

		it('should pass a lock id to the action', function() {
			assert(action.firstCall.args[0] !== undefined);
		});

		it('should ensure all updates are $isolated', function() {
			assert(update.alwaysCalledWithMatch({ $isolated: 1 }));
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
				spinlock({}, {});
			});
		});
	});

	describe('propagates error', function() {
		it('when update fails', function(done) {
			spinlock({
				update: function(query, operation, options, callback) {
					callback(new Error());
				}
			}, {
				try: Function.prototype
			}, function(err) {
				assert(err);
				done();
			});
		});

		it('when action fails', function(done) {
			spinlock({
				update: function(query, operation, options, callback) {
					callback();
				}
			}, {
				try: function(id, next) {
					next(new Error());
				}
			}, function(err) {
				assert(err);
				done();
			});
		});
	});

	(process.env.CI ? describe : describe.skip)('integration', function() {
		var url = 'mongodb://127.0.0.1:27017/test',
			db,
			collection;

		before(function(done) {
			MongoClient.connect(url, function(err, db) {
				if (err) {
					done(err);
					return;
				}

				db = db;
				collection = db.collection('collection_lock');
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
			collection.remove({}, function(err) {
				if (err) {
					done(err);
					return;
				}

				collection.insert([
					{ foo: 1 },
					{ foo: 2 },
					{ bar: 3 },
					{ baz: 4 }
				], done);
			});
		});

		it('works on a subset of documents', function(done) {
			var firstAttempt = true;

			spinlock(collection, {
				subset: { foo: { $exists: 1 } },
				try: function(id, next) {
					collection.find({}).toArray(function(err, results) {
						if (err) {
							done(err);
							return;
						}

						results.should.have.lengthOf(4);
						results.forEach(function(result) {
							if (result.foo) {
								result.should.have.property('lock');

								if (firstAttempt) {
									result.lock.should.have.lengthOf(1);
								}
							} else {
								result.should.not.have.property('lock');
							}

						});

						firstAttempt = false;

						collection.update({ $isolated: 1, 'lock.0.id': id }, { $set: { 'lock.0.released': true } },  { multi: true }, next);
					});
				}
			}, done);
		});

		it('supports custom completion release signal', function(done) {
			spinlock(collection, {
				try: function(id, next) {
					collection.update({ $isolated: 1, 'lock.0.id': id }, { $set: { 'lock.0.ping': true, 'lock.0.pong': true } }, { multi: true }, next);
				},
				until: { ping: true, pong: true }
			}, done);
		});

		it('keeps trying', function(done) {
			var attempts = 0;

			spinlock(collection, {
				try: function(id, next) {
					if (attempts < 10) {
						attempts++;
						next();
					} else {
						collection.update({ $isolated: 1, 'lock.0.id': id }, { $set: { 'lock.0.released': true } },  { multi: true }, next);
					}
				}
			}, function(err) {
				if (err) {
					done(err);
					return;
				}

				assert(attempts === 10);

				done();
			});
		});

		describe('when released', function() {
			beforeEach(function(done) {
				spinlock(collection, {
					try: function(id, next) {
						collection.update({ $isolated: 1, 'lock.0.id': id }, { $set: { 'lock.0.released': true } },  { multi: true }, next);
					}
				}, done);
			});

			it('removes locks', function(done) {
				collection.find({}).toArray(function(err, results) {
					if (err) {
						done(err);
						return;
					}

					results.should.have.lengthOf(4);
					results.forEach(function(result) {
						result.should.have.property('lock');
						result.lock.should.have.lengthOf(0);
					});

					done();
				});
			});
		});

		describe('concurrent sitaution', function() {
			this.slow(1500);

			it('update is uniform', function(done) {
				async.map(['foo', 'bar', 'baz', 'foobar', 'blah', 'many', 'doge', 'mongo'], function(term, callback) {
					spinlock(collection, {
						try: function(id, next) {
							var query = { $isolated: 1, 'lock.0.id': id };

							async.series([
								function(_next) {
									setTimeout(function() {
										collection.update(query, { $set: { first: term, 'lock.0.first': true } }, { multi: true }, _next);
									}, Math.floor((Math.random() * 100) + 1));
								},
								function(_next) {
									setTimeout(function() {
										collection.update(query, { $set: { second: term, 'lock.0.second': true } }, { multi: true }, _next);
									}, Math.floor((Math.random() * 100) + 1));
								}

							], next);
						},
						until: { first: true, second: true }
					}, callback);
				}, function(err) {
					if (err) {
						done(err);
						return;
					}

					collection.find({}).toArray(function(err, results) {
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

			it('can timeout a lock', function(done) {
				this.timeout(3000);
				this.slow(2000);

				spinlock(collection, {
					ttl: 1,
					try: function(firstId, next) {
						spinlock(collection, {
							try: function(secondId, _next) {
								collection.update({ $isolated: 1, 'lock.0.id': secondId }, { $set: { 'lock.0.released': true } }, { multi: true }, _next);
							}
						}, next);
					}
				}, function(err) {
					if (err) {
						done(err);
						return;
					}

					collection.find({}).toArray(function(err, results) {
						if (err) {
							done(err);
							return;
						}

						results.should.have.lengthOf(4);
						results.forEach(function(result) {
							result.should.have.property('lock');
							result.lock.should.have.lengthOf(0);
						});

						done();
					});
				});
			});
		});
	});
});
