var User = require('../models/user');
var Task = require('../models/task');
var h = require('./helpers');
var ApiError = h.ApiError;

function parseDeadline(value) {
    if (value === undefined || value === null || value === '') throw new ApiError(400, 'A deadline is required');
    if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) value = Number(value);
    if (typeof value !== 'string' && typeof value !== 'number') throw new ApiError(400, 'The deadline must be a valid date');
    var date = new Date(value);
    if (isNaN(date.getTime())) throw new ApiError(400, 'The deadline must be a valid date');
    return date;
}

function parseCompleted(value) {
    if (value === undefined || value === null || value === '') return false;
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    throw new ApiError(400, 'completed must be true or false');
}

// Check the request body and the assigned user. Writes nothing.
async function validateTaskBody(body) {
    body = body || {};
    var task = {
        name: h.requireString(body.name, 'name'),
        description: h.optionalString(body.description, 'description', ''),
        deadline: parseDeadline(body.deadline),
        completed: parseCompleted(body.completed),
        assignedUser: h.optionalString(body.assignedUser, 'assignedUser', ''),
        assignedUserName: 'unassigned'
    };
    var givenName = h.optionalString(body.assignedUserName, 'assignedUserName', '');

    if (task.assignedUser === '') {
        if (givenName !== '' && givenName !== 'unassigned') {
            throw new ApiError(400, 'assignedUserName is set but assignedUser is not');
        }
        return task;
    }

    if (!h.isValidId(task.assignedUser)) throw new ApiError(400, 'assignedUser is not a valid user id');
    var user = await User.findById(task.assignedUser);
    if (!user) throw new ApiError(404, 'The assigned user does not exist');
    if (givenName !== '' && givenName !== user.name) {
        throw new ApiError(400, 'assignedUserName does not match the name of the assigned user');
    }
    task.assignedUserName = user.name;
    return task;
}

// Add or remove the task from its user's pendingTasks based on "completed".
async function syncAssignedUser(task) {
    if (!task.assignedUser) return;
    var update = task.completed
        ? { $pull: { pendingTasks: String(task._id) } }
        : { $addToSet: { pendingTasks: String(task._id) } };
    await User.updateOne({ _id: task.assignedUser }, update);
}

module.exports = function (router) {

    router.route('/tasks')
        .get(async function (req, res) {
            await h.listHandler(Task, req, res, 100);
        })
        .post(async function (req, res) {
            var fields = await validateTaskBody(req.body);
            var task = await Task.create(fields);
            await syncAssignedUser(task);
            h.send(res, 201, 'Task created', task);
        });

    router.route('/tasks/:id')
        .get(async function (req, res) {
            await h.getOneHandler(Task, req, res, 'Task');
        })
        .put(async function (req, res) {
            var id = req.params.id;
            if (!h.isValidId(id)) throw new ApiError(404, 'Task not found');
            var task = await Task.findById(id);
            if (!task) throw new ApiError(404, 'Task not found');

            var fields = await validateTaskBody(req.body);
            var oldUser = task.assignedUser;

            task.set(fields);
            await task.save();

            if (oldUser && oldUser !== task.assignedUser && h.isValidId(oldUser)) {
                await User.updateOne({ _id: oldUser }, { $pull: { pendingTasks: id } });
            }
            await syncAssignedUser(task);
            h.send(res, 200, 'Task updated', task);
        })
        .delete(async function (req, res) {
            var id = req.params.id;
            if (!h.isValidId(id)) throw new ApiError(404, 'Task not found');
            var task = await Task.findById(id);
            if (!task) throw new ApiError(404, 'Task not found');

            if (h.isValidId(task.assignedUser)) {
                await User.updateOne({ _id: task.assignedUser }, { $pull: { pendingTasks: id } });
            }
            await Task.deleteOne({ _id: id });
            res.status(204).end();
        });

    return router;
};
