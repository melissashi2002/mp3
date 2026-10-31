/*
 * Shared helpers for the users and tasks routes.
 */
var mongoose = require('mongoose');

// An error with an HTTP status and a client-safe message.
class ApiError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

function send(res, status, message, data) {
    res.status(status).json({ message: message, data: data });
}

// True for a 24-character hex string (a real ObjectId).
function isValidId(id) {
    return typeof id === 'string' && /^[0-9a-fA-F]{24}$/.test(id);
}

// Parse a JSON query string parameter into a plain object.
function parseJsonParam(value, name) {
    if (value === undefined) return undefined;
    if (typeof value !== 'string') throw new ApiError(400, 'Invalid value for "' + name + '" parameter');
    var parsed;
    try {
        parsed = JSON.parse(value);
    } catch (e) {
        throw new ApiError(400, 'The "' + name + '" parameter must be valid JSON');
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new ApiError(400, 'The "' + name + '" parameter must be a JSON object');
    }
    return parsed;
}

// Parse a non-negative integer query string parameter.
function parseIntParam(value, name) {
    if (value === undefined) return undefined;
    var n = Number(value);
    if (typeof value !== 'string' || value.trim() === '' || !Number.isInteger(n) || n < 0) {
        throw new ApiError(400, 'The "' + name + '" parameter must be a non-negative integer');
    }
    return n;
}

function parseCountParam(value) {
    if (value === undefined) return false;
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw new ApiError(400, 'The "count" parameter must be true or false');
}

// GET on a collection: supports where, sort, select, skip, limit, count.
async function listHandler(Model, req, res, defaultLimit) {
    var q = req.query;
    var where = parseJsonParam(q.where, 'where') || {};
    var sort = parseJsonParam(q.sort, 'sort');
    var select = parseJsonParam(q.select !== undefined ? q.select : q.filter, 'select');
    var skip = parseIntParam(q.skip, 'skip');
    var limit = parseIntParam(q.limit, 'limit');
    var count = parseCountParam(q.count);

    try {
        if (count) {
            // Default limit only applies to returned documents, not to counts.
            var options = {};
            if (skip !== undefined) options.skip = skip;
            if (limit !== undefined && limit > 0) options.limit = limit;
            var n = await Model.countDocuments(where, options);
            return send(res, 200, 'OK', n);
        }

        var query = Model.find(where);
        if (sort) query = query.sort(sort);
        if (select) query = query.select(select);
        if (skip !== undefined) query = query.skip(skip);
        if (limit === undefined) limit = defaultLimit;
        if (limit) query = query.limit(limit);
        var docs = await query.exec();
        send(res, 200, 'OK', docs);
    } catch (err) {
        // Bad operators, bad casts, bad projections etc. come from the client.
        if (err.name === 'CastError' || err.name === 'MongoServerError' || err.name === 'StrictModeError') {
            throw new ApiError(400, 'Invalid query parameters');
        }
        throw err;
    }
}

// GET on a single resource: only "select" is supported.
async function getOneHandler(Model, req, res, label) {
    var id = req.params.id;
    if (!isValidId(id)) throw new ApiError(404, label + ' not found');
    var select = parseJsonParam(req.query.select !== undefined ? req.query.select : req.query.filter, 'select');
    var query = Model.findById(id);
    if (select) query = query.select(select);
    var doc;
    try {
        doc = await query.exec();
    } catch (err) {
        if (err.name === 'MongoServerError') throw new ApiError(400, 'Invalid select parameter');
        throw err;
    }
    if (!doc) throw new ApiError(404, label + ' not found');
    send(res, 200, 'OK', doc);
}

// A required, non-empty string.
function requireString(value, field) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new ApiError(400, 'A ' + field + ' is required');
    }
    return value;
}

// An optional string; returns the default when missing.
function optionalString(value, field, def) {
    if (value === undefined || value === null) return def;
    if (typeof value !== 'string') throw new ApiError(400, 'The ' + field + ' must be a string');
    return value;
}

module.exports = {
    ApiError: ApiError,
    send: send,
    isValidId: isValidId,
    listHandler: listHandler,
    getOneHandler: getOneHandler,
    requireString: requireString,
    optionalString: optionalString
};
