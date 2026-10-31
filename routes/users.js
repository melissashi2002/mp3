var User = require('../models/user');
var Task = require('../models/task');
var h = require('./helpers');
var ApiError = h.ApiError;

var EMAIL_RE = /^[^\s@]+@[^\s@]+$/;

// Turn the pendingTasks input into a de-duplicated list of id strings.
function parsePendingTasks(value) {
    if (value === undefined || value === null || value === '') return [];
    if (typeof value === 'string') value = [value];
    if (!Array.isArray(value)) throw new ApiError(400, 'pendingTasks must be a list of task ids');
    var ids = [];
    value.forEach(function (id) {
        if (!h.isValidId(id)) throw new ApiError(400, 'pendingTasks contains an invalid task id');
        if (ids.indexOf(id) === -1) ids.push(id);
    });
    return ids;
}

// Check the request body and referenced tasks. Writes nothing.
async function validateUserBody(body, userId) {
    body = body || {};
    var name = h.requireString(body.name, 'name');
    var email = h.requireString(body.email, 'email');
    if (!EMAIL_RE.test(email)) throw new ApiError(400, 'The email address is not valid');
    var pendingTasks = parsePendingTasks(body.pendingTasks);

    var existing = await User.findOne({ email: email });
    if (existing && String(existing._id) !== String(userId)) {
        throw new ApiError(400, 'A user with this email already exists');
    }

    var tasks = await Task.find({ _id: { $in: pendingTasks } });
    if (tasks.some(function (t) { return t.completed; })) {
        throw new ApiError(400, 'pendingTasks cannot contain a completed task');
    }
    if (tasks.length !== pendingTasks.length) {
        throw new ApiError(404, 'pendingTasks contains a task that does not exist');
    }
    return { name: name, email: email, pendingTasks: pendingTasks, tasks: tasks };
}

// Assign each task to this user, taking it away from any other user first.
async function assignTasks(user, tasks) {
    var userId = String(user._id);
    for (var i = 0; i < tasks.length; i++) {
        var task = tasks[i];
        if (task.assignedUser && task.assignedUser !== userId) {
            await User.updateOne({ _id: task.assignedUser }, { $pull: { pendingTasks: String(task._id) } });
        }
    }
    await Task.updateMany(
        { _id: { $in: tasks.map(function (t) { return t._id; }) } },
        { assignedUser: userId, assignedUserName: user.name }
    );
}

function duplicateEmail(err) {
    if (err && err.code === 11000) throw new ApiError(400, 'A user with this email already exists');
    throw err;
}

module.exports = function (router) {

    router.route('/users')
        .get(async function (req, res) {
            await h.listHandler(User, req, res, 0);
        })
        .post(async function (req, res) {
            var v = await validateUserBody(req.body, null);
            var user = await User.create({ name: v.name, email: v.email, pendingTasks: v.pendingTasks })
                .catch(duplicateEmail);
            await assignTasks(user, v.tasks);
            h.send(res, 201, 'User created', user);
        });

    router.route('/users/:id')
        .get(async function (req, res) {
            await h.getOneHandler(User, req, res, 'User');
        })
        .put(async function (req, res) {
            var id = req.params.id;
            if (!h.isValidId(id)) throw new ApiError(404, 'User not found');
            var user = await User.findById(id);
            if (!user) throw new ApiError(404, 'User not found');

            var v = await validateUserBody(req.body, id);

            // Tasks dropped from the list become unassigned.
            var removed = user.pendingTasks.filter(function (t) { return v.pendingTasks.indexOf(t) === -1; });
            await Task.updateMany(
                { _id: { $in: removed.filter(h.isValidId) }, assignedUser: id },
                { assignedUser: '', assignedUserName: 'unassigned' }
            );

            user.name = v.name;
            user.email = v.email;
            user.pendingTasks = v.pendingTasks;
            await user.save().catch(duplicateEmail);

            await assignTasks(user, v.tasks);
            // Everything still assigned to this user (completed too) gets the new name.
            await Task.updateMany({ assignedUser: id }, { assignedUserName: user.name });

            h.send(res, 200, 'User updated', user);
        })
        .delete(async function (req, res) {
            var id = req.params.id;
            if (!h.isValidId(id)) throw new ApiError(404, 'User not found');
            var user = await User.findById(id);
            if (!user) throw new ApiError(404, 'User not found');

            await Task.updateMany({ assignedUser: id }, { assignedUser: '', assignedUserName: 'unassigned' });
            await User.deleteOne({ _id: id });
            h.send(res, 200, 'User deleted', user);
        });

    return router;
};
