# mongo-spinlock
[![Circle CI](https://circleci.com/gh/dougmoscrop/node-mongodb-spinlock.svg?style=svg)](https://circleci.com/gh/dougmoscrop/node-mongodb-spinlock)
[![Coverage Status](https://coveralls.io/repos/dougmoscrop/node-mongodb-spinlock/badge.svg?branch=master&service=github)](https://coveralls.io/github/dougmoscrop/node-mongodb-spinlock?branch=master)
```javascript
var spinlock = require('mongo-spinlock');
```

The basic idea is that operations to a collection are guarded with a lock, which is pushed on to every document in the collection. Updates are then attempted, but only performed if their lock is first (i.e. they are at the front of the queue). Other writers wait (spin) and constantly check to see if either locks that are in front have expired (i.e. the process writing to them crashed) and also update their own expiry to keep their lock alive.

## Usage:

`spinlock(collection, options, callback);`

Simplest example:

```
spinlock(collection, {
    try: function(id, callback) {
		collection.update({ $isolated: 1, lock.0.id: id }, { $set: { lock.0.released: true } }, { multi: true }, callback);
    }
}, function(err) {
    // done
});
```

The above example is for illustration only and does not realy buy you anything because mongo can do $isolated writes in on update statement.

What is more interesting/useful is that you can issue multiple separate update operations where each one sets some value on the documents and on the lock.

```
spinlock(collection, {
    try: function(id, callback) {
		async.parallel([
			function(next) {
				collection.update({ $isolated: 1, lock.0.id: id }, { $set: { lock.0.stage1: true } }, { multi: true }, next);
			},
			function(next) {
				collection.update({ $isolated: 1, lock.0.id: id }, { $set: { lock.0.stage2: true } }, { multi: true }, next);
			}
		], callback);
    },
	until: { stage1: true, stage2: true }
}, function(err) {
    // done
});
```

Your update commands *MUST ALWAYS* include `{ $isolated: 1, lock.0.id: id }` in the query part (they can include additional constraints too of course but this is what makes sure your update is happening when you 'have' the lock) (see advanced notes below)

## Options

* field: name of the field in which the locks are written to, defaults to `lock`
* try: a `function(id, next)` that will be called every time the spinlock loops
* until: a custom query to detect when the lock is ready to be released, defaults to `{ released: true }`
* subset: an additional query component applied to every operation in case your document collection has some logical subsets that can each be acccessed using different "pools" of locks.

## Why :(

Well, if you needed a real database but instead chose mongodb and you need some kind of consistency fantasy between read a value -> write a value on the same collection this can accomodate that, you can use a lock, query for an item by id, and then only issue your update if the items `lock[0].id` is your id (just keep calling `next()` in `try` if it's not). This might just buy you enough time before everything else goes to hell.

This only works if *all changes to a particular field go through a spinlock* for hopefully obvious reasons.

### Advanced Notes

You can issue update commands that aren't restricted to `lock.0.id` if they're just marking a lock as released and not modifying the object. It still goes "lock everything" then "release the unnecessary stuff".

Newly created items don't participate in the lock, so whatever logic / hopes / dreams you have needs to be able to deal with that. Also all your updates need to be idempotent and all that jazz.
