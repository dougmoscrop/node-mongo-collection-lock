var assert = require('assert'),
	sinon = require('sinon'),
	optlock = require('../lib');

require('should');

describe('collection lock', function() {
	var fakeCollection;

	beforeEach(function() {
		fakeCollection = {
			update: function(query, operation, options, callback) {
				callback();
			},
			count: function(query, callback) {
				callback(null, 0);
			}
		};

		sinon.spy(fakeCollection, 'update');
		sinon.spy(fakeCollection, 'count');
	});

	it('unit', function(done) {
		optlock({
			field: 'test',
			collection: fakeCollection,
			action: function(query, next) {
				query.should.have.properties('all', 'ready');

				query.all.should.have.property('$isolated', 1);

				query.ready.should.have.property('$isolated', 1);
				query.ready.should.have.property('test.0.id');

				next();
			}
		}, function complete() {
			assert(fakeCollection.update.called);
			assert(fakeCollection.count.calledOnce);

			done();
		});
	});

	(process.env.CI ? it : it.skip)('integration', function(done) {
		done();
	});
});
