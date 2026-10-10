// @vitest-environment node
// The batch downloader's own tests (tick-every-document.user.js 3.14), ported
// from Node's runner to Vitest and pointed at src/lib/batch. They drive the
// pure logic with fakes: a Map for storage, events with their times in them,
// and stand-ins for fetch, XMLHttpRequest, URL and a link.

import { test } from "vitest";
import assert from "node:assert";
import * as tick from "../src/lib/batch/index.js";

const PAGE = 'https://www.knauf.com/en-GB/download-centre?page=1';
const KEY = tick.ledgerKey(PAGE);
const NINE = '2026-10-09T09:00:00.000Z';
const TEN = '2026-10-09T10:00:00.000Z';

/* ------------------------------------------------------------------ */
/* Fakes                                                               */
/* ------------------------------------------------------------------ */

function fakeStorage() {
    const data = new Map();
    return {
        data: data,
        getItem: function (key) { return data.has(key) ? data.get(key) : null; },
        setItem: function (key, value) { data.set(key, String(value)); },
        removeItem: function (key) { data.delete(key); },
        key: function (index) {
            const keys = Array.from(data.keys());
            return index < keys.length ? keys[index] : null;
        },
        get length() { return data.size; }
    };
}

// What a browser hands over in a private window, a sandboxed frame, or a
// profile with site data blocked: storage that throws on every touch.
function refusingStorage() {
    const refuse = function () { throw new Error('storage refused'); };
    return {
        getItem: refuse,
        setItem: refuse,
        removeItem: refuse,
        key: refuse,
        get length() { return refuse(); }
    };
}

// A results row as the page shows it: a title, a type, a format, a size.
function rowText(title) {
    return title + '\nDeclaration of Performance\nPDF\n245 KB';
}

function pageOf(titles) {
    return tick.identitiesFor(titles.map(rowText));
}

function numbered(count) {
    return Array.from({ length: count }, function (_, at) {
        return 'Product ' + (at + 1);
    });
}

function ids(rows) {
    return rows.map(function (each) { return each.id; });
}

const PRESSED = 1000000;
const LIMIT = 90000;

function watching(batch) {
    return tick.newWatch(batch, PRESSED, LIMIT);
}

function play(watch, events) {
    return events.reduce(function (state, event) {
        return tick.observe(state, event);
    }, watch);
}

function zipArrived(batch, at) {
    return {
        kind: 'response', via: 'xhr', batch: batch, method: 'POST',
        url: '/api/download', status: 200, contentType: 'application/zip',
        disposition: 'attachment; filename="Archive_20261009101500.zip"',
        at: at, failed: false
    };
}

function jsonArrived(batch, at) {
    return {
        kind: 'response', via: 'fetch', batch: batch, method: 'GET',
        url: '/api/status', status: 200,
        contentType: 'application/json; charset=utf-8', disposition: '',
        at: at, failed: false
    };
}

// A stand-in XMLHttpRequest whose own open and send return markers, so a
// wrapper that drops a return value is caught.
function fakeXhrClass(calls) {
    function FakeXHR() {
        this.listeners = {};
        this.readyState = 0;
        this.status = 0;
        this.headers = '';
        this.responseURL = '';
    }
    FakeXHR.prototype.open = function () {
        calls.push(['open', this, Array.from(arguments)]);
        this.readyState = 1;
        return 'opened';
    };
    FakeXHR.prototype.send = function () {
        calls.push(['send', this, Array.from(arguments)]);
        return 'sent';
    };
    FakeXHR.prototype.addEventListener = function (type, listener) {
        (this.listeners[type] = this.listeners[type] || []).push(listener);
    };
    FakeXHR.prototype.getAllResponseHeaders = function () {
        return this.headers;
    };
    // As a browser does it: headers first (readyState 2), then the whole
    // body (readyState 4), then load and loadend, each listener in the
    // order it was added.
    FakeXHR.prototype.finish = function (status, headers, address) {
        const xhr = this;
        const fire = function (type) {
            (xhr.listeners[type] || []).slice().forEach(function (listener) {
                listener.call(xhr, { type: type });
            });
        };
        xhr.status = status;
        xhr.headers = headers;
        xhr.responseURL = address || '';
        xhr.readyState = 2;
        fire('readystatechange');
        xhr.readyState = 4;
        fire('readystatechange');
        fire('load');
        fire('loadend');
    };
    return FakeXHR;
}

// A link that inherits click from a general element, as a real anchor
// inherits it from HTMLElement, so the test can show only links are watched.
function fakeLinkClasses() {
    function Element() {}
    Element.prototype.click = function () {
        this.clicked = (this.clicked || 0) + 1;
        return 'clicked';
    };
    function Anchor(href, download) {
        this.href = href;
        this.downloadName = download || '';
    }
    Anchor.prototype = Object.create(Element.prototype);
    Anchor.prototype.getAttribute = function (name) {
        return name === 'download' ? this.downloadName : null;
    };
    return { Element: Element, Anchor: Anchor };
}

function quietly(ms) {
    return new Promise(function (done) { setTimeout(done, ms); });
}

/* ------------------------------------------------------------------ */
/* A row's identity                                                    */
/* ------------------------------------------------------------------ */

test('a row is known by its own text, whatever its spacing and case', function () {
    const one = tick.rowIdentity('  DriTherm   Cavity Slab 32\n\tPDF   245 KB ');
    const two = tick.rowIdentity('dritherm cavity slab 32 pdf 245 kb');
    assert.strictEqual(one.id, 'dritherm cavity slab 32 pdf 245 kb');
    assert.strictEqual(one.id, two.id);
});

// THE OWNER'S FIND, 2026-10-09: about 130 Knauf rows were never offered,
// every one a technical drawing printed as DWG. A row is known by a file
// type beside a size, and the types were only PDF, Word, Excel and ZIP.
test('a row offering a drawing, a model or an image is a document row too', function () {
    ['DWG', 'DXF', 'RVT', 'RFA', 'IFC', 'SKP', 'DGN', 'STP', 'STEP', 'IGS', '3DS',
        'OBJ', 'FBX', 'GSM', 'PLN', '3DM', 'DWF', 'NWD', 'JPG', 'PNG', 'TIF', 'SVG',
        'EPS', 'PPTX', 'TXT', 'CSV', 'RAR', '7Z', 'MP4'].forEach(function (type) {
        assert.ok(tick.LOOKS_LIKE_A_FILE.test('METAL Axal Vector (CAD 2D)\nTechnical Drawing\n'
            + 'Oct 2025\n' + type + '\n338.14 kB\nEN'), type + ' should mark a document row');
    });
    const row = tick.rowIdentity('METAL Axal Vector (CAD 2D)\nTechnical Drawing\nOct 2025\n'
        + 'DWG\n338.14 kB\nEN');
    assert.strictEqual(row.format, 'DWG');
    assert.strictEqual(row.size, '338.14 kB');
    // A filter row still says neither a type with a size nor a size.
    assert.ok(!(tick.LOOKS_LIKE_A_FILE.test('Technical Drawing (130)')
        && tick.LOOKS_LIKE_A_SIZE.test('Technical Drawing (130)')));
});

test('the identity carries the title, the format and the size', function () {
    const row = tick.rowIdentity(
        'DriTherm Cavity Slab 32\nDeclaration of Performance\nPDF\n1,2 MB');
    assert.strictEqual(row.format, 'PDF');
    assert.strictEqual(row.size, '1,2 MB');
    assert.strictEqual(row.title,
        'DriTherm Cavity Slab 32 / Declaration of Performance');
});

test('two rows that read the same on one page are told apart, so both are fetched', function () {
    const page = tick.identitiesFor([rowText('A'), rowText('A'), rowText('B')]);
    assert.deepStrictEqual(ids(page), [
        'a declaration of performance pdf 245 kb',
        'a declaration of performance pdf 245 kb #2',
        'b declaration of performance pdf 245 kb'
    ]);
});

/* ------------------------------------------------------------------ */
/* The ledger                                                          */
/* ------------------------------------------------------------------ */

test('the ledger is kept per origin and path, whatever the query or the hash', function () {
    assert.strictEqual(
        tick.ledgerKey('https://www.knauf.com/en-GB/download-centre?page=2#top'), KEY);
    assert.notStrictEqual(tick.ledgerKey('https://www.knauf.com/en-GB/other'), KEY);
    assert.notStrictEqual(
        tick.ledgerKey('https://www.knauf.de/en-GB/download-centre'), KEY);
    assert.ok(KEY.indexOf(tick.LEDGER_PREFIX) === 0);
});

test('a batch is taken in page order and capped at the batch size', function () {
    const page = pageOf(numbered(25));
    const ledger = tick.emptyLedger(KEY);
    const first = tick.chooseBatch(page, ledger, 10, 'fresh');
    assert.deepStrictEqual(ids(first), ids(page.slice(0, 10)));
    tick.recordBatch(ledger, first, 1, 'confirmed', TEN, {});
    const second = tick.chooseBatch(page, ledger, 10, 'fresh');
    assert.deepStrictEqual(ids(second), ids(page.slice(10, 20)));
    assert.strictEqual(tick.chooseBatch(page, ledger, 0, 'fresh').length, 1);
});

test('a confirmed row is never offered again, even after a reload', function () {
    const storage = fakeStorage();
    const page = pageOf(['A', 'B', 'C']);
    const before = tick.openStore(storage, KEY);
    before.record([page[0]], before.nextBatch(), 'confirmed', TEN, {});
    const after = tick.openStore(storage, KEY);
    assert.deepStrictEqual(
        ids(tick.chooseBatch(page, after.read(), 10, 'fresh')),
        [page[1].id, page[2].id]);
    assert.deepStrictEqual(tick.chooseBatch(page, after.read(), 10, 'retry'), []);
});

test('an unconfirmed row waits for Retry unconfirmed, not for Start', function () {
    const page = pageOf(['A', 'B', 'C', 'D']);
    const ledger = tick.emptyLedger(KEY);
    tick.recordBatch(ledger, [page[0]], 1, 'confirmed', NINE, {});
    tick.recordBatch(ledger, [page[1], page[2]], 2, 'unconfirmed', TEN,
        { reason: 'timeout' });
    assert.deepStrictEqual(ids(tick.chooseBatch(page, ledger, 10, 'fresh')),
        [page[3].id]);
    assert.deepStrictEqual(ids(tick.chooseBatch(page, ledger, 10, 'retry')),
        [page[1].id, page[2].id]);
    assert.deepStrictEqual(ids(tick.chooseBatch(page, ledger, 1, 'retry')),
        [page[1].id]);
    assert.throws(function () { tick.chooseBatch(page, ledger, 10, 'all'); });
});

test('every row records its batch, its time, its status and what was seen', function () {
    const page = pageOf(['DriTherm Cavity Slab 32']);
    const ledger = tick.emptyLedger(KEY);
    tick.recordBatch(ledger, page, 12, 'confirmed', TEN,
        { evidence: 'xhr POST /api/download 200 application/zip', where: '?page=2' });
    const row = ledger.rows[page[0].id];
    assert.strictEqual(row.batch, 12);
    assert.strictEqual(row.at, TEN);
    assert.strictEqual(row.status, 'confirmed');
    assert.strictEqual(row.title, 'DriTherm Cavity Slab 32 / Declaration of Performance');
    assert.strictEqual(row.format, 'PDF');
    assert.strictEqual(row.size, '245 KB');
    assert.strictEqual(row.where, '?page=2');
    assert.strictEqual(row.tries, 1);
    assert.strictEqual(ledger.batches.length, 1);
    assert.strictEqual(ledger.batches[0].batch, 12);
    assert.strictEqual(ledger.batches[0].rows, 1);
    assert.ok(ledger.nextBatch > 12);
    assert.throws(function () {
        tick.recordBatch(ledger, page, 13, 'done', TEN, {});
    });
});

test('a confirmed row stays confirmed if it is ever recorded unconfirmed', function () {
    const page = pageOf(['A']);
    const ledger = tick.emptyLedger(KEY);
    tick.recordBatch(ledger, page, 1, 'confirmed', NINE, {});
    tick.recordBatch(ledger, page, 2, 'unconfirmed', TEN, { reason: 'timeout' });
    assert.strictEqual(ledger.rows[page[0].id].status, 'confirmed');
    assert.strictEqual(ledger.rows[page[0].id].batch, 1);
});

test('a retried row that is confirmed stops being unconfirmed', function () {
    const page = pageOf(['A']);
    const ledger = tick.emptyLedger(KEY);
    tick.recordBatch(ledger, page, 1, 'unconfirmed', NINE, { reason: 'timeout' });
    tick.recordBatch(ledger, page, 2, 'confirmed', TEN, {});
    const row = ledger.rows[page[0].id];
    assert.strictEqual(row.status, 'confirmed');
    assert.strictEqual(row.batch, 2);
    assert.strictEqual(row.tries, 2);
});

test('the script still works when the browser refuses storage', function () {
    [refusingStorage(), null].forEach(function (storage) {
        const store = tick.openStore(storage, KEY);
        const page = pageOf(['A', 'B']);
        store.record([page[0]], store.nextBatch(), 'confirmed', TEN, {});
        assert.strictEqual(store.saved(), false);
        assert.deepStrictEqual(
            ids(tick.chooseBatch(page, store.read(), 10, 'fresh')), [page[1].id]);
    });
    assert.deepStrictEqual(tick.readLedger(refusingStorage(), KEY).rows, {});
    assert.strictEqual(
        tick.writeLedger(refusingStorage(), KEY, tick.emptyLedger(KEY)), false);
    assert.deepStrictEqual(tick.listLedgerKeys(refusingStorage(), tick.LEDGER_PREFIX), []);
});

test('a stored ledger that is not a ledger is read as empty, not as an error', function () {
    const storage = fakeStorage();
    ['not json at all', 'null', '[]', '{"rows":[]}', '42'].forEach(function (raw) {
        storage.setItem(KEY, raw);
        const ledger = tick.readLedger(storage, KEY);
        assert.deepStrictEqual(ledger.rows, {});
        assert.strictEqual(ledger.nextBatch, 1);
    });
    storage.setItem(KEY, JSON.stringify({
        rows: {
            good: { status: 'confirmed', batch: 1 },
            odd: { status: 'pending', batch: 2 },
            empty: null
        },
        nextBatch: 3,
        batches: []
    }));
    assert.deepStrictEqual(Object.keys(tick.readLedger(storage, KEY).rows), ['good']);
});

test('two tabs on one site do not overwrite each other', function () {
    const storage = fakeStorage();
    const page = pageOf(['A', 'B', 'C']);
    const left = tick.openStore(storage, KEY);
    const right = tick.openStore(storage, KEY);
    left.record([page[0]], left.nextBatch(), 'confirmed', NINE, {});
    right.record([page[1]], right.nextBatch(), 'unconfirmed', TEN, { reason: 'timeout' });
    const later = tick.openStore(storage, KEY).read();
    assert.strictEqual(later.rows[page[0].id].status, 'confirmed');
    assert.strictEqual(later.rows[page[1].id].status, 'unconfirmed');
});

test('when two records of one row disagree, confirmed wins whichever is newer', function () {
    const page = pageOf(['A']);
    const confirmed = tick.emptyLedger(KEY);
    tick.recordBatch(confirmed, page, 1, 'confirmed', NINE, {});
    const unconfirmed = tick.emptyLedger(KEY);
    tick.recordBatch(unconfirmed, page, 2, 'unconfirmed', TEN, { reason: 'timeout' });
    [tick.mergeLedgers(confirmed, unconfirmed), tick.mergeLedgers(unconfirmed, confirmed)]
        .forEach(function (merged) {
            assert.strictEqual(merged.rows[page[0].id].status, 'confirmed');
            assert.strictEqual(merged.nextBatch, 3);
            assert.strictEqual(merged.batches.length, 2);
        });
});

test('batch numbers carry on across a reload', function () {
    const storage = fakeStorage();
    const first = tick.openStore(storage, KEY);
    assert.strictEqual(first.nextBatch(), 1);
    assert.strictEqual(first.nextBatch(), 2);
    assert.strictEqual(tick.openStore(storage, KEY).nextBatch(), 3);
});

test('the counts say what is confirmed, unconfirmed and still to do', function () {
    const page = pageOf(['A', 'B', 'C', 'D', 'E']);
    const ledger = tick.emptyLedger(KEY);
    tick.recordBatch(ledger, [page[0], page[1]], 1, 'confirmed', NINE, {});
    tick.recordBatch(ledger, [page[2]], 2, 'unconfirmed', TEN, { reason: 'timeout' });
    tick.recordBatch(ledger, pageOf(['Elsewhere']), 3, 'confirmed', TEN, {});
    assert.deepStrictEqual(tick.pageCounts(page, ledger),
        { rows: 5, todo: 2, confirmed: 2, unconfirmed: 1 });
    assert.deepStrictEqual(tick.ledgerCounts(ledger),
        { confirmed: 3, unconfirmed: 1 });
});

test('a late file is noted against its batch but does not confirm it', function () {
    const page = pageOf(['A', 'B']);
    const ledger = tick.emptyLedger(KEY);
    tick.recordBatch(ledger, page, 4, 'unconfirmed', NINE, { reason: 'timeout' });
    assert.strictEqual(tick.noteLate(ledger, 4,
        'xhr POST /api/download 200 application/zip', TEN), true);
    const record = ledger.batches.filter(function (each) { return each.batch === 4; })[0];
    assert.ok(record.late);
    assert.strictEqual(record.late.at, TEN);
    assert.strictEqual(ledger.rows[page[0].id].status, 'unconfirmed');
    assert.strictEqual(ledger.rows[page[1].id].status, 'unconfirmed');
    assert.strictEqual(tick.noteLate(ledger, 99, 'anything', TEN), false);
});

/* ------------------------------------------------------------------ */
/* What counts as a file                                               */
/* ------------------------------------------------------------------ */

function looksLikeAFile(contentType, disposition, status) {
    return tick.isFileResponse({
        status: status === undefined ? 200 : status,
        contentType: contentType,
        disposition: disposition
    });
}

test('a zip, an octet stream, a pdf or an attachment is a file', function () {
    assert.strictEqual(looksLikeAFile('application/zip'), true);
    assert.strictEqual(looksLikeAFile('application/x-zip-compressed'), true);
    assert.strictEqual(looksLikeAFile('Application/Octet-Stream'), true);
    assert.strictEqual(looksLikeAFile('application/pdf; charset=binary'), true);
    assert.strictEqual(looksLikeAFile('application/json', 'attachment; filename="list.json"'), true);
    assert.strictEqual(looksLikeAFile('', 'Attachment'), true);
    assert.strictEqual(looksLikeAFile('application/zip', '', 206), true);
});

test('a page, a JSON reply, or a failed or refused request is not a file', function () {
    assert.strictEqual(looksLikeAFile('text/html; charset=utf-8'), false);
    assert.strictEqual(looksLikeAFile('application/json'), false);
    assert.strictEqual(looksLikeAFile('text/html', 'inline'), false);
    assert.strictEqual(looksLikeAFile('text/html', 'inline; filename="attachment.html"'), false);
    assert.strictEqual(looksLikeAFile('application/zipper'), false);
    assert.strictEqual(looksLikeAFile('application/zip', '', 404), false);
    assert.strictEqual(looksLikeAFile('application/zip', 'attachment', 500), false);
    assert.strictEqual(looksLikeAFile('application/zip', '', 0), false);
    assert.strictEqual(looksLikeAFile('application/zip', '', 'two hundred'), false);
    assert.strictEqual(looksLikeAFile('', ''), false);
    assert.strictEqual(looksLikeAFile(undefined, undefined), false);
});

test('headers are read from a raw header block, whatever their case', function () {
    const head = tick.headersFromRaw(
        'Date: Fri, 09 Oct 2026 10:15:00 GMT\r\n'
        + 'Content-Type: application/zip\r\n'
        + 'CONTENT-DISPOSITION: attachment; filename="Archive_20261009101500.zip"\r\n');
    assert.strictEqual(head.contentType, 'application/zip');
    assert.strictEqual(head.disposition,
        'attachment; filename="Archive_20261009101500.zip"');
    assert.deepStrictEqual(tick.headersFromRaw(''), { contentType: '', disposition: '' });
    assert.deepStrictEqual(tick.headersFromRaw(null), { contentType: '', disposition: '' });
});

/* ------------------------------------------------------------------ */
/* The button's count                                                  */
/* ------------------------------------------------------------------ */

test('the count is read out of the button text', function () {
    assert.strictEqual(tick.countFromButtonText('Download (10)'), 10);
    assert.strictEqual(tick.countFromButtonText('  Download\n( 3 ) '), 3);
    assert.strictEqual(tick.countFromButtonText('Download selected (7)'), 7);
    assert.strictEqual(tick.countFromButtonText('Download\n10'), 10);
    assert.strictEqual(tick.countFromButtonText('Download (0)'), 0);
    assert.strictEqual(tick.countFromButtonText('Download'), null);
    assert.strictEqual(tick.countFromButtonText(''), null);
    assert.strictEqual(tick.countFromButtonText(null), null);
});

/* ------------------------------------------------------------------ */
/* The watch: confirmed or unconfirmed, from events and a clock         */
/* ------------------------------------------------------------------ */

test('a file sent for this batch after its press confirms it', function () {
    const watch = play(watching(5), [
        jsonArrived(5, PRESSED + 2000),
        zipArrived(5, PRESSED + 7000)
    ]);
    assert.strictEqual(watch.status, 'confirmed');
    assert.ok(/application\/zip/.test(watch.evidence));
});

test('a blob made after the press, then a click on a link to it, confirms the batch', function () {
    const watch = play(watching(5), [
        { kind: 'blob', at: PRESSED + 6000, batch: 5, url: 'blob:https://www.knauf.com/4f1c',
            type: 'application/zip', size: 2048 },
        { kind: 'anchor', at: PRESSED + 6001, batch: 5, href: 'blob:https://www.knauf.com/4f1c',
            download: 'Archive_20261009101500.zip' }
    ]);
    assert.strictEqual(watch.status, 'confirmed');
});

test('a click on a link with no blob made after the press confirms nothing', function () {
    const early = play(watching(5), [
        { kind: 'blob', at: PRESSED - 10, batch: 4, url: 'blob:https://www.knauf.com/old' },
        { kind: 'anchor', at: PRESSED + 10, batch: 5, href: 'blob:https://www.knauf.com/old' }
    ]);
    assert.strictEqual(early.status, 'waiting');
    const elsewhere = play(watching(5), [
        { kind: 'blob', at: PRESSED + 10, batch: 5, url: 'blob:https://www.knauf.com/one' },
        { kind: 'anchor', at: PRESSED + 20, batch: 5, href: 'blob:https://www.knauf.com/two' },
        { kind: 'anchor', at: PRESSED + 30, batch: 5, href: 'https://www.knauf.com/terms' }
    ]);
    assert.strictEqual(elsewhere.status, 'waiting');
});

test('nothing arriving in time is recorded unconfirmed, never confirmed', function () {
    const ticking = [];
    for (let at = PRESSED; at < PRESSED + LIMIT; at += 500) {
        ticking.push({ kind: 'clock', at: at });
    }
    assert.strictEqual(play(watching(5), ticking).status, 'waiting');
    const timedOut = play(watching(5), ticking.concat([{ kind: 'clock', at: PRESSED + LIMIT }]));
    assert.strictEqual(timedOut.status, 'unconfirmed');
    assert.strictEqual(timedOut.reason, 'timeout');
});

test('a file that arrives after the time allowed is too late, and a decision is final', function () {
    const late = play(watching(5), [zipArrived(5, PRESSED + LIMIT + 1)]);
    assert.strictEqual(late.status, 'unconfirmed');
    assert.strictEqual(late.reason, 'timeout');
    assert.strictEqual(tick.observe(late, zipArrived(5, PRESSED + LIMIT + 2)).status,
        'unconfirmed');
    const confirmed = play(watching(5), [zipArrived(5, PRESSED + 10)]);
    assert.strictEqual(tick.observe(confirmed, { kind: 'stop', at: PRESSED + 20 }).status,
        'confirmed');
});

test('a file belonging to the batch before does not confirm this one', function () {
    const watch = play(watching(5), [
        zipArrived(4, PRESSED + 3000),
        { kind: 'blob', at: PRESSED + 3001, batch: 5, url: 'blob:https://www.knauf.com/a' },
        { kind: 'anchor', at: PRESSED + 3002, batch: 5, href: 'blob:https://www.knauf.com/a' }
    ]);
    assert.strictEqual(watch.status, 'waiting');
    assert.strictEqual(tick.observe(watch, zipArrived(5, PRESSED + 9000)).status, 'confirmed');
});

test('an earlier batch\'s file still arriving makes a blob and link click that follow doubtful', function () {
    const arriving = zipArrived(4, PRESSED + 3000);
    arriving.kind = 'incoming';
    const watch = play(watching(5), [
        arriving,
        { kind: 'blob', at: PRESSED + 4000, batch: 5, url: 'blob:https://www.knauf.com/b' },
        { kind: 'anchor', at: PRESSED + 4001, batch: 5, href: 'blob:https://www.knauf.com/b' }
    ]);
    assert.strictEqual(watch.status, 'waiting');
    const ownArriving = zipArrived(5, PRESSED + 5000);
    ownArriving.kind = 'incoming';
    assert.strictEqual(tick.observe(watch, ownArriving).status, 'waiting');
    assert.strictEqual(tick.observe(watch, zipArrived(5, PRESSED + 6000)).status, 'confirmed');
});

test('a file sent outside any batch confirms nothing', function () {
    assert.strictEqual(play(watching(5), [zipArrived(null, PRESSED + 10)]).status, 'waiting');
    assert.strictEqual(play(watching(5), [zipArrived(undefined, PRESSED + 10)]).status, 'waiting');
});

test('a page, a JSON reply or a broken download after the press is not evidence', function () {
    const broken = zipArrived(5, PRESSED + 50);
    broken.failed = true;
    const html = jsonArrived(5, PRESSED + 60);
    html.contentType = 'text/html';
    const watch = play(watching(5), [jsonArrived(5, PRESSED + 40), broken, html]);
    assert.strictEqual(watch.status, 'waiting');
});

test('a HEAD request carries no file, whatever its headers say', function () {
    const asked = zipArrived(5, PRESSED + 50);
    asked.method = 'HEAD';
    assert.strictEqual(play(watching(5), [asked]).status, 'waiting');
});

test('Stop records the batch in hand as unconfirmed', function () {
    const watch = tick.observe(watching(5), { kind: 'stop', at: PRESSED + 10 });
    assert.strictEqual(watch.status, 'unconfirmed');
    assert.strictEqual(watch.reason, 'stopped');
});

test('an event with no usable time is ignored', function () {
    assert.strictEqual(play(watching(5), [zipArrived(5, NaN)]).status, 'waiting');
    assert.strictEqual(play(watching(5), [zipArrived(5, undefined)]).status, 'waiting');
});

/* ------------------------------------------------------------------ */
/* The wrappers, against stand-ins                                     */
/* ------------------------------------------------------------------ */

test('the fetch wrapper returns the very promise the page would have had, and the page still reads the body', async function () {
    const calls = [];
    const response = new Response('PK zip bytes', {
        status: 200,
        headers: {
            'content-type': 'application/zip',
            'content-disposition': 'attachment; filename="Archive_20261009101500.zip"'
        }
    });
    const promise = Promise.resolve(response);
    const scope = {
        fetch: function () {
            calls.push({ self: this, args: Array.from(arguments) });
            return promise;
        }
    };
    let heard;
    const noted = new Promise(function (done) { heard = done; });
    const notes = [];
    const wrapped = tick.installWrappers(scope, {
        tag: function () { return 7; },
        now: function () { return 1234; },
        base: function () { return PAGE; },
        note: function (event) {
            notes.push(event);
            if (event.kind === 'response') { heard(event); }
        }
    });
    assert.strictEqual(wrapped.fetch, true);
    const init = { method: 'POST', body: 'ids=1,2,3' };
    const got = scope.fetch('https://www.knauf.com/api/download?token=SECRET', init);
    assert.strictEqual(got, promise);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].self, scope);
    assert.strictEqual(calls[0].args.length, 2);
    assert.strictEqual(calls[0].args[0], 'https://www.knauf.com/api/download?token=SECRET');
    assert.strictEqual(calls[0].args[1], init);
    const page = await got;
    assert.strictEqual(page, response);
    assert.strictEqual(await page.text(), 'PK zip bytes');
    const event = await noted;
    assert.strictEqual(event.kind, 'response');
    assert.strictEqual(event.via, 'fetch');
    assert.strictEqual(event.batch, 7);
    assert.strictEqual(event.method, 'POST');
    assert.strictEqual(event.url, '/api/download');
    assert.strictEqual(event.status, 200);
    assert.strictEqual(event.contentType, 'application/zip');
    assert.strictEqual(event.failed, false);
    assert.strictEqual(event.at, 1234);
    // Announced as soon as its headers arrived, before the body was read.
    assert.deepStrictEqual(notes.map(function (each) { return each.kind; }),
        ['incoming', 'response']);
    assert.strictEqual(notes[0].batch, 7);
});

test('a fetch that fails still fails for the page', async function () {
    const scope = {
        fetch: function () { return Promise.reject(new TypeError('Failed to fetch')); }
    };
    const notes = [];
    tick.installWrappers(scope, {
        tag: function () { return 2; },
        now: function () { return 10; },
        base: function () { return PAGE; },
        note: function (event) { notes.push(event); }
    });
    await assert.rejects(scope.fetch('https://www.knauf.com/api/download'), TypeError);
    await quietly(5);
    assert.strictEqual(notes.length, 1);
    assert.strictEqual(notes[0].failed, true);
    assert.strictEqual(tick.isFileResponse(notes[0]), false);
});

test('with no batch waiting, the fetch wrapper only calls through', async function () {
    let cloned = 0;
    const response = new Response('x', {
        status: 200, headers: { 'content-type': 'application/zip' }
    });
    const realClone = response.clone.bind(response);
    response.clone = function () { cloned++; return realClone(); };
    const scope = { fetch: function () { return Promise.resolve(response); } };
    const notes = [];
    tick.installWrappers(scope, {
        tag: function () { return null; },
        now: function () { return 1; },
        base: function () { return PAGE; },
        note: function (event) { notes.push(event); }
    });
    const got = await scope.fetch('https://www.knauf.com/a');
    await quietly(10);
    assert.strictEqual(got, response);
    assert.strictEqual(cloned, 0);
    assert.strictEqual(notes.length, 0);
});

test('the XMLHttpRequest wrapper passes every call through and reports a finished file', function () {
    const calls = [];
    const FakeXHR = fakeXhrClass(calls);
    const notes = [];
    const wrapped = tick.installWrappers({ XMLHttpRequest: FakeXHR }, {
        tag: function () { return 3; },
        now: function () { return 5000; },
        base: function () { return PAGE; },
        note: function (event) { notes.push(event); }
    });
    assert.strictEqual(wrapped.xhr, true);
    const xhr = new FakeXHR();
    assert.strictEqual(xhr.open('POST', '/api/download?token=SECRET', true), 'opened');
    const body = { ids: [1, 2] };
    assert.strictEqual(xhr.send(body), 'sent');
    assert.deepStrictEqual(calls.map(function (each) { return each[0]; }), ['open', 'send']);
    assert.strictEqual(calls[0][1], xhr);
    assert.deepStrictEqual(calls[0][2], ['POST', '/api/download?token=SECRET', true]);
    assert.strictEqual(calls[1][1], xhr);
    assert.strictEqual(calls[1][2][0], body);
    assert.strictEqual(notes.length, 0);
    xhr.finish(200, 'Content-Type: application/zip\r\n'
        + 'Content-Disposition: attachment; filename="Archive_20261009101500.zip"\r\n');
    assert.deepStrictEqual(notes.map(function (each) { return each.kind; }),
        ['incoming', 'response']);
    assert.strictEqual(notes[0].batch, 3);
    const event = notes[1];
    assert.strictEqual(event.kind, 'response');
    assert.strictEqual(event.via, 'xhr');
    assert.strictEqual(event.batch, 3);
    assert.strictEqual(event.method, 'POST');
    assert.strictEqual(event.url, '/api/download');
    assert.strictEqual(event.status, 200);
    assert.strictEqual(event.contentType, 'application/zip');
    assert.strictEqual(event.at, 5000);
    assert.strictEqual(tick.isFileResponse(event), true);
});

test('a blob and a click on a link are reported, both calls pass through, and only links are watched', function () {
    const made = [];
    const fakeURL = {
        createObjectURL: function (thing) {
            made.push({ self: this, thing: thing });
            return 'blob:https://www.knauf.com/4f1c';
        }
    };
    const classes = fakeLinkClasses();
    const elementClick = classes.Element.prototype.click;
    const notes = [];
    const wrapped = tick.installWrappers(
        { URL: fakeURL, HTMLAnchorElement: classes.Anchor }, {
            tag: function () { return 9; },
            now: function () { return 100; },
            base: function () { return PAGE; },
            note: function (event) { notes.push(event); }
        });
    assert.strictEqual(wrapped.blob, true);
    assert.strictEqual(wrapped.anchor, true);
    const zip = { type: 'application/zip', size: 2048 };
    assert.strictEqual(fakeURL.createObjectURL(zip), 'blob:https://www.knauf.com/4f1c');
    assert.strictEqual(made[0].self, fakeURL);
    assert.strictEqual(made[0].thing, zip);
    const link = new classes.Anchor('blob:https://www.knauf.com/4f1c',
        'Archive_20261009101500.zip');
    assert.strictEqual(link.click(), 'clicked');
    assert.strictEqual(link.clicked, 1);
    assert.strictEqual(classes.Element.prototype.click, elementClick);
    assert.deepStrictEqual(notes.map(function (each) { return each.kind; }), ['blob', 'anchor']);
    assert.strictEqual(notes[0].url, 'blob:https://www.knauf.com/4f1c');
    assert.strictEqual(notes[0].type, 'application/zip');
    assert.strictEqual(notes[1].href, 'blob:https://www.knauf.com/4f1c');
    assert.strictEqual(notes[1].download, 'Archive_20261009101500.zip');
    assert.strictEqual(play(tick.newWatch(9, 0, LIMIT), notes).status, 'confirmed');
});

test('a late zip from the batch before cannot confirm this one, even when the page listened first', function () {
    const FakeXHR = fakeXhrClass([]);
    const classes = fakeLinkClasses();
    let made = 0;
    const fakeURL = {
        createObjectURL: function () {
            made++;
            return 'blob:https://www.knauf.com/late-' + made;
        }
    };
    let pressed = 4;
    const notes = [];
    tick.installWrappers(
        { XMLHttpRequest: FakeXHR, URL: fakeURL, HTMLAnchorElement: classes.Anchor }, {
            tag: function () { return pressed; },
            now: function () { return PRESSED + 1000; },
            base: function () { return PAGE; },
            note: function (event) { notes.push(event); }
        });
    const xhr = new FakeXHR();
    // The page listens BEFORE it opens, so its handler runs first and
    // hands the zip over the moment the last byte is in.
    xhr.addEventListener('readystatechange', function () {
        if (xhr.readyState === 4 && xhr.status === 200) {
            new classes.Anchor(fakeURL.createObjectURL({ type: 'application/zip' }),
                'Archive_20261009101500.zip').click();
        }
    });
    xhr.open('POST', '/api/download');
    xhr.send('ids');
    // Batch 4 timed out; batch 5 is pressed before batch 4's zip comes back.
    pressed = 5;
    xhr.finish(200, 'content-type: application/zip\r\n');
    assert.deepStrictEqual(notes.map(function (each) { return each.kind; }),
        ['incoming', 'blob', 'anchor', 'response']);
    assert.strictEqual(play(tick.newWatch(5, PRESSED, LIMIT), notes).status, 'waiting');
});

test('a fault in the script\'s own bookkeeping never reaches the page', async function () {
    const boom = function () { throw new Error('bookkeeping fault'); };
    // The last sink fails only on the FINAL report of a fetch, which is
    // made from inside a promise callback once the copy has been read: a
    // throw there would reach the page as an unhandled rejection, so
    // those are collected and must stay empty.
    const sinks = [
        { tag: boom, now: boom, base: boom, note: boom },
        { tag: function () { return 1; }, now: boom, base: boom, note: boom },
        { tag: function () { return 1; }, now: function () { return 1; },
            base: function () { return PAGE; }, note: boom },
        { tag: function () { return 1; }, now: function () { return 1; },
            base: function () { return PAGE; },
            note: function (event) { if (event.kind === 'response') { boom(); } } }
    ];
    const escaped = [];
    const collect = function (reason) { escaped.push(String(reason)); };
    process.on('unhandledRejection', collect);
    try {
        await everySink(sinks);
        await quietly(20);
    } finally {
        process.removeListener('unhandledRejection', collect);
    }
    assert.deepStrictEqual(escaped, []);
});

async function everySink(sinks) {
    for (const sink of sinks) {
        const calls = [];
        const FakeXHR = fakeXhrClass(calls);
        const classes = fakeLinkClasses();
        const response = new Response('PK', {
            status: 200, headers: { 'content-type': 'application/zip' }
        });
        const promise = Promise.resolve(response);
        const fakeURL = { createObjectURL: function () { return 'blob:x/1'; } };
        const scope = {
            fetch: function () { return promise; },
            XMLHttpRequest: FakeXHR,
            URL: fakeURL,
            HTMLAnchorElement: classes.Anchor
        };
        tick.installWrappers(scope, sink);
        assert.strictEqual(scope.fetch('https://www.knauf.com/a?b=c'), promise);
        assert.strictEqual(await (await promise).text(), 'PK');
        const xhr = new FakeXHR();
        assert.strictEqual(xhr.open('GET', '/a'), 'opened');
        assert.strictEqual(xhr.send(), 'sent');
        xhr.finish(200, 'content-type: application/zip\r\n');
        assert.strictEqual(fakeURL.createObjectURL({}), 'blob:x/1');
        assert.strictEqual(new classes.Anchor('blob:x/1').click(), 'clicked');
        assert.strictEqual(calls.length, 2);
        await quietly(10);
    }
}

test('the wrappers leave a page without those features alone', function () {
    const sink = {
        tag: function () { return 1; },
        now: function () { return 1; },
        base: function () { return PAGE; },
        note: function () {}
    };
    const none = { fetch: false, xhr: false, blob: false, anchor: false };
    assert.deepStrictEqual(tick.installWrappers({}, sink), none);
    assert.deepStrictEqual(tick.installWrappers(null, sink), none);
});

/* ------------------------------------------------------------------ */
/* Settings, export, and what gets written down                        */
/* ------------------------------------------------------------------ */

test('the defaults are the ones asked for', function () {
    assert.strictEqual(tick.DEFAULT_BATCH, 10);
    assert.strictEqual(tick.DEFAULT_TIMEOUT, 90);
    // Cut from 2 to 1 in 3.3, at the coordinator's request.
    assert.strictEqual(tick.DEFAULT_SETTLE, 1);
    assert.strictEqual(tick.DEFAULT_RETRY_BATCH, 3);
});

test('a setting typed on the panel is read as a number within its bounds', function () {
    assert.strictEqual(tick.readSetting('10', 10, 1, 50, true), 10);
    assert.strictEqual(tick.readSetting('', 90, 10, 600, true), 90);
    assert.strictEqual(tick.readSetting('ninety', 90, 10, 600, true), 90);
    assert.strictEqual(tick.readSetting('0', 10, 1, 50, true), 1);
    assert.strictEqual(tick.readSetting('999', 10, 1, 50, true), 50);
    assert.strictEqual(tick.readSetting('2.5', 2, 0, 30, false), 2.5);
    assert.strictEqual(tick.readSetting('7.9', 10, 1, 50, true), 7);
    assert.strictEqual(tick.readSetting('NaN', 3, 1, 10, true), 3);
    assert.strictEqual(tick.readSetting('Infinity', 3, 1, 10, true), 3);
});

test('the export names every unconfirmed document', function () {
    const storage = fakeStorage();
    storage.setItem('someone else', '{"rows":{}}');
    const store = tick.openStore(storage, KEY);
    const page = pageOf(['DriTherm Cavity Slab 32', 'Rocksilk RainScreen Slab',
        'Earthwool Flexible Slab']);
    store.record([page[0]], store.nextBatch(), 'confirmed', NINE, {});
    store.record([page[1], page[2]], store.nextBatch(), 'unconfirmed', TEN,
        { reason: 'timeout' });
    const keys = tick.listLedgerKeys(storage, tick.LEDGER_PREFIX);
    assert.deepStrictEqual(keys, [KEY]);
    const out = tick.buildExport(keys.map(function (key) {
        return tick.readLedger(storage, key);
    }), { at: '2026-10-09T11:00:00.000Z', origin: 'https://www.knauf.com', script: '3.0' });
    assert.deepStrictEqual(out.totals, { confirmed: 1, unconfirmed: 2 });
    assert.deepStrictEqual(out.unconfirmed.map(function (each) { return each.title; }), [
        'Earthwool Flexible Slab / Declaration of Performance',
        'Rocksilk RainScreen Slab / Declaration of Performance'
    ]);
    assert.strictEqual(out.unconfirmed[0].format, 'PDF');
    assert.strictEqual(out.unconfirmed[0].size, '245 KB');
    assert.strictEqual(out.unconfirmed[0].batch, 2);
    assert.strictEqual(out.confirmed[0].title,
        'DriTherm Cavity Slab 32 / Declaration of Performance');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(out)).totals, out.totals);
});

test('nothing the script writes down keeps a query string', function () {
    assert.strictEqual(tick.shortUrl('https://www.knauf.com/api/dl?token=SECRET#x', PAGE),
        '/api/dl');
    assert.strictEqual(tick.shortUrl('https://cdn.example.com/a/b.zip?sig=SECRET', PAGE),
        'cdn.example.com/a/b.zip');
    assert.strictEqual(tick.shortUrl('/api/dl?token=SECRET', PAGE), '/api/dl');
    const said = tick.describeEvent({
        kind: 'anchor', at: 1, href: 'https://cdn.example.com/a.zip?sig=SECRET', download: ''
    }, PAGE);
    assert.ok(said.length > 0);
    assert.ok(!/SECRET/.test(said));
});

/* ------------------------------------------------------------------ */
/* Version 3.1: Play or Pause, Stop, Reset, batch size, Select button  */
/* ------------------------------------------------------------------ */

// A page the run drives: rows with a box each, a press that answers from
// a script of outcomes ('confirmed', 'unconfirmed', or 'hold' to wait
// until the test lets it go), and a take that can be told to refuse.
function runnerPage(titles) {
    const rows = pageOf(titles).map(function (identity) {
        return { identity: identity, box: { checked: false } };
    });
    const page = {
        presses: [],
        unticked: 0,
        holding: null,
        script: [],
        button: 'the page\'s own button',
        refuse: false,
        lastChosen: [],
        rows: function () { return rows; },
        take: function (chosen, halted) {
            page.lastChosen = chosen;
            if (halted()) {
                return Promise.resolve({ ok: false, halted: true, problem: '' });
            }
            if (page.refuse) {
                return Promise.resolve({ ok: false, halted: false,
                    problem: 'The page did not take the selection.' });
            }
            return Promise.resolve({ ok: true, button: page.button, count: chosen.length });
        },
        press: function (button, batch) {
            page.presses.push({
                batch: batch,
                button: button,
                ids: page.lastChosen.map(function (each) { return each.identity.id; })
            });
            const next = page.script.shift() || 'confirmed';
            if (next === 'hold') {
                return new Promise(function (done) { page.holding = done; });
            }
            return Promise.resolve(next === 'confirmed'
                ? { status: 'confirmed', evidence: 'done: xhr POST /api/download 200 application/zip', reason: '' }
                : { status: 'unconfirmed', evidence: '', reason: 'timeout' });
        },
        abortWait: function () {
            if (page.holding) {
                const done = page.holding;
                page.holding = null;
                done({ status: 'unconfirmed', evidence: '', reason: 'stopped' });
            }
        },
        untick: function (chosen) { page.unticked += chosen.length; }
    };
    return page;
}

function runnerFor(page, options) {
    const extra = options || {};
    const storage = extra.storage || fakeStorage();
    const store = tick.openStore(storage, KEY);
    const stores = new Map([[KEY, store]]);
    const seen = { said: [], states: [], saves: [], confirms: [] };
    const runner = tick.createRunner({
        store: function () { return store; },
        page: page,
        settings: function () {
            return { size: 10, retrySize: 3, timeout: 90,
                settle: extra.settle === undefined ? 2 : extra.settle,
                startAt: extra.startAt === undefined ? 1 : extra.startAt };
        },
        formats: typeof extra.formats === 'function' ? extra.formats
            : function () { return extra.formats === undefined ? null : extra.formats; },
        sleep: extra.sleep || function () { return Promise.resolve(); },
        now: extra.now || function () { return 0; },
        iso: function () { return TEN; },
        where: function () { return '?page=1'; },
        say: function (text) { seen.said.push(text); },
        showState: function (state) { seen.states.push(state); },
        refresh: function () {},
        siteDocuments: function () {
            return tick.siteTotals(storage, stores, tick.LEDGER_PREFIX).documents;
        },
        saveExport: function () {
            seen.saves.push(tick.ledgerCounts(store.read()));
            return 'document-ledger-www.knauf.com-20261009-100000.json';
        },
        forgetSite: function () { return tick.forgetSite(storage, stores, tick.LEDGER_PREFIX); },
        confirm: function (text) { seen.confirms.push(text); return extra.answer === true; }
    });
    return { runner: runner, store: store, storage: storage, stores: stores, seen: seen };
}

function lastSaid(run) {
    return run.seen.said[run.seen.said.length - 1] || '';
}

const CONFIRMED = { status: 'confirmed', evidence: 'done: xhr POST /api/download 200 application/zip', reason: '' };

test('Play takes every unseen row, then goes on to the unconfirmed ones in batches of three', async function () {
    const page = runnerPage(numbered(13));
    page.script = ['confirmed', 'unconfirmed', 'confirmed'];
    const run = runnerFor(page);
    await run.runner.play();
    assert.deepStrictEqual(page.presses.map(function (each) { return each.ids.length; }),
        [10, 3, 3]);
    assert.deepStrictEqual(page.presses[2].ids, page.presses[1].ids);
    const ledger = run.store.read();
    assert.deepStrictEqual(tick.ledgerCounts(ledger), { confirmed: 13, unconfirmed: 0 });
    assert.deepStrictEqual(ledger.batches.map(function (each) { return each.mode; }),
        ['fresh', 'fresh', 'retry']);
    assert.strictEqual(run.runner.state(), 'idle');
});

test('a Play tries each unconfirmed row once, and the next Play goes straight on to them', async function () {
    const page = runnerPage(numbered(3));
    page.script = ['unconfirmed', 'unconfirmed'];
    const run = runnerFor(page);
    await run.runner.play();
    assert.strictEqual(page.presses.length, 2);
    assert.deepStrictEqual(tick.ledgerCounts(run.store.read()), { confirmed: 0, unconfirmed: 3 });
    assert.ok(/Play retries them/.test(lastSaid(run)), lastSaid(run));
    page.script = ['confirmed'];
    await run.runner.play();
    assert.strictEqual(page.presses.length, 3);
    assert.deepStrictEqual(page.presses[2].ids, page.presses[0].ids);
    const ledger = run.store.read();
    assert.strictEqual(ledger.batches[ledger.batches.length - 1].mode, 'retry');
    assert.deepStrictEqual(tick.ledgerCounts(ledger), { confirmed: 3, unconfirmed: 0 });
});

test('Pause lets the batch in flight finish its wait, then stops before the next batch', async function () {
    const page = runnerPage(numbered(25));
    page.script = ['hold'];
    const run = runnerFor(page);
    const ended = run.runner.play();
    await quietly(5);
    assert.strictEqual(page.presses.length, 1);
    assert.strictEqual(tick.playLabel(run.runner.state()), 'Pause');
    run.runner.pause();
    assert.strictEqual(run.runner.state(), 'pausing');
    assert.strictEqual(tick.playLabel(run.runner.state()), 'Play');
    // The zip arrives after Pause was pressed: it is not cut off.
    page.holding(CONFIRMED);
    await ended;
    assert.strictEqual(page.presses.length, 1);
    assert.deepStrictEqual(tick.ledgerCounts(run.store.read()), { confirmed: 10, unconfirmed: 0 });
    assert.strictEqual(run.runner.state(), 'idle');
    assert.strictEqual(run.seen.saves.length, 0);
    assert.ok(/^Paused/.test(lastSaid(run)), lastSaid(run));
    await run.runner.play();
    assert.deepStrictEqual(page.presses.map(function (each) { return each.ids.length; }),
        [10, 10, 5]);
    assert.strictEqual(page.presses[1].ids.indexOf(page.presses[0].ids[0]), -1);
});

test('Play pressed while a pause is pending carries the run on', async function () {
    const page = runnerPage(numbered(25));
    page.script = ['hold'];
    const run = runnerFor(page);
    const ended = run.runner.play();
    await quietly(5);
    run.runner.pause();
    run.runner.play();
    assert.strictEqual(run.runner.state(), 'running');
    page.holding(CONFIRMED);
    await ended;
    assert.deepStrictEqual(page.presses.map(function (each) { return each.ids.length; }),
        [10, 10, 5]);
});

test('Pause before a batch is pressed puts it back unpressed and unrecorded', async function () {
    const page = runnerPage(numbered(5));
    const run = runnerFor(page);
    const realTake = page.take;
    page.take = function (chosen, halted) {
        run.runner.pause();
        return realTake(chosen, halted);
    };
    await run.runner.play();
    assert.strictEqual(page.presses.length, 0);
    assert.deepStrictEqual(run.store.read().rows, {});
    assert.strictEqual(page.unticked, 5);
    assert.ok(/^Paused/.test(lastSaid(run)), lastSaid(run));
});

test('Stop records the batch in flight unconfirmed and saves the list', async function () {
    const page = runnerPage(numbered(25));
    page.script = ['hold'];
    const run = runnerFor(page);
    const ended = run.runner.play();
    await quietly(5);
    run.runner.stop();
    await ended;
    assert.strictEqual(page.presses.length, 1);
    assert.deepStrictEqual(tick.ledgerCounts(run.store.read()), { confirmed: 0, unconfirmed: 10 });
    assert.deepStrictEqual(run.seen.saves, [{ confirmed: 0, unconfirmed: 10 }]);
    assert.strictEqual(run.runner.state(), 'idle');
    assert.ok(/Saved document-ledger/.test(lastSaid(run)), lastSaid(run));
});

test('a run that finishes on its own saves the list; one that pressed nothing does not', async function () {
    const page = runnerPage(numbered(5));
    const run = runnerFor(page);
    await run.runner.play();
    assert.deepStrictEqual(run.seen.saves, [{ confirmed: 5, unconfirmed: 0 }]);
    assert.ok(/Saved document-ledger/.test(lastSaid(run)), lastSaid(run));
    await run.runner.play();
    assert.strictEqual(page.presses.length, 1);
    assert.strictEqual(run.seen.saves.length, 1);
    assert.ok(/^Nothing to do/.test(lastSaid(run)), lastSaid(run));
});

test('three batches in a row with nothing seen stop the run and save the list', async function () {
    const page = runnerPage(numbered(40));
    page.script = ['unconfirmed', 'unconfirmed', 'unconfirmed'];
    const run = runnerFor(page);
    await run.runner.play();
    assert.strictEqual(page.presses.length, 3);
    assert.strictEqual(run.seen.saves.length, 1);
    assert.ok(/^Stopped: 3 batches in a row/.test(lastSaid(run)), lastSaid(run));
});

test('Stop with nothing running saves the list, and saves nothing from an empty ledger', async function () {
    const page = runnerPage(numbered(3));
    const run = runnerFor(page);
    run.runner.stop();
    assert.strictEqual(run.seen.saves.length, 0);
    assert.ok(/empty/.test(lastSaid(run)), lastSaid(run));
    await run.runner.play();
    assert.strictEqual(run.seen.saves.length, 1);
    run.runner.stop();
    assert.strictEqual(run.seen.saves.length, 2);
});

test('a selection the page refuses is never pressed, and nothing is recorded or saved', async function () {
    const page = runnerPage(numbered(5));
    page.refuse = true;
    const run = runnerFor(page);
    await run.runner.play();
    assert.strictEqual(page.presses.length, 0);
    assert.deepStrictEqual(run.store.read().rows, {});
    assert.strictEqual(run.seen.saves.length, 0);
    assert.strictEqual(page.unticked, 5);
    assert.ok(/did not take the selection/.test(lastSaid(run)), lastSaid(run));
});

test('the run presses the button the selection check settled on', async function () {
    const page = runnerPage(numbered(2));
    const selected = { name: 'the button the owner selected' };
    page.button = selected;
    const run = runnerFor(page);
    await run.runner.play();
    assert.strictEqual(page.presses[0].button, selected);
});

test('Reset forgets the site\'s ledger only after a confirm naming how many documents', async function () {
    const storage = fakeStorage();
    const page = runnerPage(numbered(7));
    const first = runnerFor(page, { storage: storage, answer: false });
    await first.runner.play();
    const other = tick.openStore(storage,
        tick.ledgerKey('https://www.knauf.com/en-GB/another-centre'));
    other.record(pageOf(['Elsewhere']), other.nextBatch(), 'unconfirmed', TEN, {});

    assert.strictEqual(first.runner.reset(), false);
    assert.strictEqual(first.seen.confirms.length, 1);
    assert.ok(/\b8 document/.test(first.seen.confirms[0]), first.seen.confirms[0]);
    assert.deepStrictEqual(tick.ledgerCounts(tick.openStore(storage, KEY).read()),
        { confirmed: 7, unconfirmed: 0 });

    const second = runnerFor(page, { storage: storage, answer: true });
    assert.strictEqual(second.runner.reset(), true);
    assert.ok(/\b8 document/.test(second.seen.confirms[0]), second.seen.confirms[0]);
    assert.deepStrictEqual(tick.listLedgerKeys(storage, tick.LEDGER_PREFIX), []);
    assert.deepStrictEqual(tick.ledgerCounts(second.store.read()),
        { confirmed: 0, unconfirmed: 0 });
    await second.runner.play();
    assert.strictEqual(page.presses.length, 2);
    assert.strictEqual(page.presses[1].ids.length, 7);
});

test('Reset asks nothing while a run is going, or when there is nothing to forget', async function () {
    const page = runnerPage(numbered(25));
    page.script = ['hold'];
    const run = runnerFor(page, { answer: true });
    assert.strictEqual(run.runner.reset(), false);
    assert.strictEqual(run.seen.confirms.length, 0);
    const ended = run.runner.play();
    await quietly(5);
    assert.strictEqual(run.runner.reset(), false);
    assert.strictEqual(run.seen.confirms.length, 0);
    page.holding(CONFIRMED);
    run.runner.pause();
    await ended;
    assert.deepStrictEqual(tick.ledgerCounts(run.store.read()), { confirmed: 10, unconfirmed: 0 });
});

// Adapted in 3.3: the owner asked for a sixth control, "start at row".
// Adapted in 3.5: and for a selector of the file types fetched. Its
// switches are drawn from the rows into qs-types, so the html still holds
// the same six controls.
// Adapted in 3.13: and for a seventh, Select all.
// (The panel test that stood here moved to tests/batch-panel.test.js: the zapper builds
// its panel from DOM nodes, not an HTML string.)

test('the Play button names what pressing it does', function () {
    assert.strictEqual(tick.playLabel('idle'), 'Play');
    assert.strictEqual(tick.playLabel('running'), 'Pause');
    assert.strictEqual(tick.playLabel('pausing'), 'Play');
    assert.strictEqual(tick.playLabel('stopping'), 'Play');
});

// Element stand-ins: just what describing and finding a button reads.
function element(tag, attrs, parent, text) {
    const made = {
        tagName: tag.toUpperCase(),
        id: attrs.id || '',
        className: attrs.class || '',
        parentElement: parent || null,
        innerText: text || '',
        attrs: attrs
    };
    made.getAttribute = function (name) {
        return Object.prototype.hasOwnProperty.call(made.attrs, name) ? made.attrs[name] : null;
    };
    return made;
}

function toolbarButton(count, footer) {
    const body = element('body', {}, null, '');
    const holder = element('div', { class: footer ? 'footer' : 'toolbar' }, body, '');
    return element('button', { class: footer ? 'btn' : 'btn btn-primary' }, holder,
        'Download (' + count + ')');
}

test('the selected download button is found again after the page redraws it', function () {
    const chosen = toolbarButton(0);
    const record = tick.describeButton(chosen);
    assert.strictEqual(record.words, 'download');
    assert.strictEqual(record.path, 'div.toolbar > button.btn.btn-primary');
    const redrawn = toolbarButton(10);
    const decoy = toolbarButton(10, true);
    const everyone = function () { return true; };
    assert.strictEqual(tick.locateButton(record, [decoy, redrawn], everyone), redrawn);
    assert.strictEqual(tick.locateButton(record, [decoy], everyone), decoy);
    const renamed = element('button', { class: 'btn btn-primary' }, redrawn.parentElement,
        'Basket');
    assert.strictEqual(tick.locateButton(record, [renamed], everyone), null);
    assert.strictEqual(tick.locateButton(record, [redrawn], function () { return false; }), null);
});

test('the selected button is used when it can be found, and the automatic one when not', function () {
    const record = tick.describeButton(toolbarButton(0));
    const selected = toolbarButton(10);
    const automatic = { name: 'found automatically' };
    assert.deepStrictEqual(
        tick.pickButton(record, function () { return selected; }, function () { return automatic; }),
        { button: selected, source: 'selected', lost: false });
    assert.deepStrictEqual(
        tick.pickButton(record, function () { return null; }, function () { return automatic; }),
        { button: automatic, source: 'automatic', lost: true });
    assert.deepStrictEqual(
        tick.pickButton(null, function () { return selected; }, function () { return automatic; }),
        { button: automatic, source: 'automatic', lost: false });
    assert.deepStrictEqual(
        tick.pickButton(null, function () { return null; }, function () { return null; }),
        { button: null, source: 'none', lost: false });
    assert.ok(/yours/.test(tick.describeUse(
        { source: 'selected', lost: false }, 'Download (0)')));
    assert.ok(/isn't here; using/.test(tick.describeUse(
        { source: 'automatic', lost: true }, 'Download (0)')));
    assert.ok(/found "Download \(0\)"/.test(tick.describeUse(
        { source: 'automatic', lost: false }, 'Download (0)')));
});

test('Select download button takes the next click a person makes, and keeps it from the page', function () {
    const listeners = [];
    const fakeWindow = {
        addEventListener: function (type, listener, capture) {
            listeners.push({ type: type, listener: listener, capture: capture });
        },
        removeEventListener: function (type, listener, capture) {
            const at = listeners.findIndex(function (each) {
                return each.type === type && each.listener === listener
                    && each.capture === capture;
            });
            if (at >= 0) { listeners.splice(at, 1); }
        }
    };
    const ours = { name: 'a control on the panel' };
    const theirs = { name: 'the page\'s Download button' };
    const picked = [];
    function click(target, trusted) {
        const event = {
            target: target, isTrusted: trusted, prevented: 0, stopped: 0, stoppedNow: 0,
            preventDefault: function () { this.prevented++; },
            stopPropagation: function () { this.stopped++; },
            stopImmediatePropagation: function () { this.stoppedNow++; }
        };
        listeners.slice().forEach(function (each) {
            if (each.type === 'click') { each.listener.call(fakeWindow, event); }
        });
        return event;
    }
    tick.armCapture(fakeWindow, function (target) { return target === ours; },
        function (target) { picked.push(target); });
    // Adapted for the zapper: the presses and releases around the click are
    // held back too, for pages that act on mousedown.
    assert.deepStrictEqual(listeners.map(function (each) { return each.type; }).sort(),
        ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup']);
    assert.ok(listeners.every(function (each) { return each.capture === true; }));
    // The script's own clicks, and clicks on the panel, pass untouched.
    assert.strictEqual(click(theirs, false).prevented, 0);
    assert.strictEqual(click(ours, true).prevented, 0);
    assert.deepStrictEqual(picked, []);
    const person = click(theirs, true);
    assert.strictEqual(person.prevented, 1);
    assert.strictEqual(person.stopped, 1);
    assert.deepStrictEqual(picked, [theirs]);
    assert.strictEqual(listeners.length, 0);
    assert.strictEqual(click(theirs, true).prevented, 0);
    const disarm = tick.armCapture(fakeWindow, function () { return false; },
        function (target) { picked.push(target); });
    disarm();
    assert.strictEqual(listeners.length, 0);
    assert.strictEqual(picked.length, 1);
});

test('the selected button is remembered for the whole site, and storage refusing it throws nothing', function () {
    const storage = fakeStorage();
    const key = tick.buttonKey('https://www.knauf.com/en-GB/download-centre?page=2');
    assert.strictEqual(key, tick.buttonKey('https://www.knauf.com/somewhere/else'));
    assert.notStrictEqual(key, tick.buttonKey('https://www.knauf.de/en-GB/download-centre'));
    const record = tick.describeButton(toolbarButton(0));
    assert.strictEqual(tick.writeButtonRecord(storage, key, record), true);
    assert.deepStrictEqual(tick.readButtonRecord(storage, key), record);
    assert.strictEqual(tick.readButtonRecord(refusingStorage(), key), null);
    assert.strictEqual(tick.writeButtonRecord(refusingStorage(), key, record), false);
    ['nonsense', '{"words":""}', 'null', '[]'].forEach(function (raw) {
        storage.setItem(key, raw);
        assert.strictEqual(tick.readButtonRecord(storage, key), null);
    });
});

// Rows with real-ish boxes for the selection check: a click toggles.
function tickableRows(count) {
    return pageOf(numbered(count)).map(function (identity) {
        return {
            identity: identity,
            box: {
                checked: false,
                click: function () { this.checked = !this.checked; }
            }
        };
    });
}

function countingButton(rows, offset) {
    return {
        disabled: false,
        getAttribute: function () { return null; },
        get innerText() {
            return 'Download (' + (rows.filter(function (each) {
                return each.box.checked;
            }).length + (offset || 0)) + ')';
        }
    };
}

function selectionEnv(rows, button) {
    let clock = 0;
    return {
        rows: function () { return rows; },
        button: function () { return button; },
        sleep: function (seconds) { clock += seconds * 1000; return Promise.resolve(); },
        now: function () { return clock; },
        halted: function () { return false; }
    };
}

test('stray ticks are cleared before pressing, and the button in use is the one handed back', async function () {
    const rows = tickableRows(6);
    rows[5].box.checked = true;
    const button = countingButton(rows);
    const taken = await tick.takeSelection(rows.slice(0, 3), selectionEnv(rows, button));
    assert.strictEqual(taken.ok, true);
    assert.strictEqual(taken.button, button);
    assert.strictEqual(taken.count, 3);
    assert.deepStrictEqual(rows.map(function (each) { return each.box.checked; }),
        [true, true, true, false, false, false]);
});

test('a selection the page will not take is handed back refused, with every box cleared', async function () {
    const rows = tickableRows(4);
    const taken = await tick.takeSelection(rows.slice(0, 3),
        selectionEnv(rows, countingButton(rows, 1)));
    assert.strictEqual(taken.ok, false);
    assert.ok(/did not take the selection/.test(taken.problem), taken.problem);
    assert.ok(/Download \(4\)/.test(taken.problem), taken.problem);
    assert.ok(rows.every(function (each) { return !each.box.checked; }));
});

/* ------------------------------------------------------------------ */
/* Version 3.2: live rows, Load more, and every way a file is handed  */
/* ------------------------------------------------------------------ */

function addRows(page, titles) {
    const rows = page.rows();
    pageOf(titles).forEach(function (identity) {
        rows.push({ identity: identity, box: { checked: false } });
    });
}

test('rows that appear after Play are taken in the next batch', async function () {
    const page = runnerPage(numbered(10));
    const press = page.press;
    page.press = function (button, batch) {
        if (batch === 1) { addRows(page, ['Loaded later 1', 'Loaded later 2', 'Loaded later 3']); }
        return press(button, batch);
    };
    const run = runnerFor(page);
    await run.runner.play();
    assert.deepStrictEqual(page.presses.map(function (each) { return each.ids.length; }), [10, 3]);
    assert.ok(page.presses[1].ids.every(function (id) { return /^loaded later/.test(id); }));
    assert.deepStrictEqual(tick.ledgerCounts(run.store.read()), { confirmed: 13, unconfirmed: 0 });
});

test('Load more is pressed when the unseen rows run out, and no more once a press adds nothing', async function () {
    const page = runnerPage(numbered(10));
    const calls = [];
    page.loadMore = function () {
        calls.push(page.presses.length);
        if (calls.length === 1) {
            addRows(page, numbered(20).slice(10));
            return Promise.resolve({ pressed: true, grew: true, before: 10, after: 20 });
        }
        return Promise.resolve({ pressed: true, grew: false, before: 20, after: 20 });
    };
    const run = runnerFor(page);
    await run.runner.play();
    // Pressed only once the ten on the page were done, and once more to
    // find it adds nothing.
    assert.deepStrictEqual(calls, [1, 2]);
    assert.deepStrictEqual(page.presses.map(function (each) { return each.ids.length; }), [10, 10]);
    assert.deepStrictEqual(tick.ledgerCounts(run.store.read()), { confirmed: 20, unconfirmed: 0 });
    assert.ok(/^Done: 2 batch\(es\)\./.test(lastSaid(run)), lastSaid(run));
    await run.runner.play();
    assert.strictEqual(calls.length, 3);
    assert.strictEqual(page.presses.length, 2);
});

test('with no Load more on the page, the run ends when the rows run out', async function () {
    const page = runnerPage(numbered(4));
    let calls = 0;
    page.loadMore = function () {
        calls++;
        return Promise.resolve({ pressed: false, grew: false, before: 4, after: 4 });
    };
    const run = runnerFor(page);
    await run.runner.play();
    assert.strictEqual(calls, 1);
    assert.strictEqual(page.presses.length, 1);
    assert.strictEqual(run.runner.state(), 'idle');
});

test('a Load more or Show more control is known by its words', function () {
    ['Load more', 'SHOW MORE', 'Load more documents', '  Load\nmore (80) ', 'Show more results']
        .forEach(function (words) {
            assert.strictEqual(tick.isLoadMoreText(words), true, words);
        });
    ['Download', 'Loading more', 'More', 'Download (10)', '', null,
        'Load more than ten documents at once by changing your account settings']
        .forEach(function (words) {
            assert.strictEqual(tick.isLoadMoreText(words), false, String(words));
        });
});

test('waiting for Load more ends as soon as the rows grow, and gives up at its ceiling', async function () {
    let clock = 0;
    let count = 20;
    const sleep = function (seconds) {
        clock += seconds * 1000;
        if (clock >= 1000) { count = 30; }
        return Promise.resolve();
    };
    const grown = await tick.waitForGrowth(function () { return count; }, 20, sleep,
        function () { return clock; }, 15000);
    assert.deepStrictEqual(grown, { grew: true, after: 30 });
    assert.ok(clock <= 1250, 'waited ' + clock + 'ms');
    clock = 0;
    const stuck = await tick.waitForGrowth(function () { return 20; }, 20,
        function (seconds) { clock += seconds * 1000; return Promise.resolve(); },
        function () { return clock; }, 15000);
    assert.deepStrictEqual(stuck, { grew: false, after: 20 });
    assert.ok(clock >= 15000 && clock < 16000, 'waited ' + clock + 'ms');
});

test('the window losing focus and getting it back after the press ends the wait at once', function () {
    const watch = play(watching(5), [
        { kind: 'blur', at: PRESSED + 1500, visible: true },
        { kind: 'focus', at: PRESSED + 6000, hasFocus: true, visible: true }
    ]);
    assert.strictEqual(watch.status, 'confirmed');
    assert.strictEqual(watch.decidedAt, PRESSED + 6000);
    assert.ok(/Save window/.test(watch.evidence), watch.evidence);
});

test('a focus with no blur after the press, or a trip to another tab, is not a Save window', function () {
    assert.strictEqual(play(watching(5), [
        { kind: 'focus', at: PRESSED + 6000, hasFocus: true, visible: true }
    ]).status, 'waiting');
    assert.strictEqual(play(watching(5), [
        { kind: 'blur', at: PRESSED - 500, visible: true },
        { kind: 'focus', at: PRESSED + 6000, hasFocus: true, visible: true }
    ]).status, 'waiting');
    assert.strictEqual(play(watching(5), [
        { kind: 'blur', at: PRESSED + 1000, visible: true },
        { kind: 'visibility', at: PRESSED + 1001, visible: false },
        { kind: 'visibility', at: PRESSED + 5000, visible: true },
        { kind: 'focus', at: PRESSED + 5001, hasFocus: true, visible: true }
    ]).status, 'waiting');
    assert.strictEqual(play(watching(5), [
        { kind: 'blur', at: PRESSED + 1000, visible: true },
        { kind: 'focus', at: PRESSED + 5001, hasFocus: false, visible: true }
    ]).status, 'waiting');
});

function resourceAt(extra) {
    return Object.assign({
        kind: 'resource', initiatorType: 'xmlhttprequest',
        name: 'https://www.knauf.com/api/basket', started: PRESSED + 100, at: PRESSED + 8000,
        encodedBodySize: 0, transferSize: 0, contentType: '', responseStatus: 0
    }, extra);
}

test('a fetch or XHR that began after the press and carries a file ends the wait at its end', function () {
    const big = play(watching(5), [resourceAt({ encodedBodySize: 2400000, transferSize: 2400300 })]);
    assert.strictEqual(big.status, 'confirmed');
    assert.strictEqual(big.decidedAt, PRESSED + 8000);
    const named = play(watching(5), [resourceAt({
        initiatorType: 'fetch', name: 'https://cdn.example.com/x/Archive_20261009101500.zip?sig=1'
    })]);
    assert.strictEqual(named.status, 'confirmed');
    assert.ok(!/sig=/.test(named.evidence), named.evidence);
    assert.strictEqual(play(watching(5), [resourceAt({
        name: 'https://www.knauf.com/api/assets/download', encodedBodySize: 0, transferSize: 0
    })]).status, 'confirmed');
});

test('a resource that is not a file, began before the press, or failed does not end the wait', function () {
    [
        resourceAt({ name: 'https://www.knauf.com/en-GB/download-centre/api/selection',
            encodedBodySize: 412, transferSize: 712 }),
        resourceAt({ name: 'https://www.knauf.com/api/archive', contentType: 'application/json' }),
        resourceAt({ started: PRESSED - 10, encodedBodySize: 2400000 }),
        resourceAt({ initiatorType: 'img', encodedBodySize: 2400000 }),
        resourceAt({ encodedBodySize: 2400000, responseStatus: 500 }),
        resourceAt({})
    ].forEach(function (event, at) {
        assert.strictEqual(play(watching(5), [event]).status, 'waiting', 'case ' + at);
    });
});

test('a resource timing entry is placed on the press\'s own clock', function () {
    const event = tick.resourceEvent({
        name: 'https://www.knauf.com/api/x', initiatorType: 'fetch', startTime: 5100,
        responseEnd: 9000, encodedBodySize: 1, transferSize: 2, contentType: 'application/zip',
        responseStatus: 200
    }, 5000, PRESSED);
    assert.strictEqual(event.kind, 'resource');
    assert.strictEqual(event.started, PRESSED + 100);
    assert.strictEqual(event.at, PRESSED + 4000);
    assert.strictEqual(event.contentType, 'application/zip');
    assert.strictEqual(event.responseStatus, 200);
});

test('a download only started (a link, a new window, a form, a frame, leaving) does not end the wait', function () {
    const started = [
        { kind: 'anchor', at: PRESSED + 100, href: 'https://www.knauf.com/download/Archive.zip' },
        { kind: 'open', at: PRESSED + 200, url: 'https://www.knauf.com/download?ids=1' },
        { kind: 'submit', at: PRESSED + 300, url: 'https://www.knauf.com/download', method: 'POST' },
        { kind: 'iframe', at: PRESSED + 400, url: 'https://www.knauf.com/download?ids=1' },
        { kind: 'unload', at: PRESSED + 500 },
        { kind: 'button', at: PRESSED + 600, disabled: true, text: 'Preparing' }
    ];
    const watch = play(watching(5), started);
    assert.strictEqual(watch.status, 'waiting');
    const ended = tick.observe(watch, { kind: 'clock', at: PRESSED + LIMIT });
    assert.strictEqual(ended.status, 'unconfirmed');
    assert.strictEqual(ended.reason, 'timeout');
});

test('the trace of each batch reaches the saved list, timed from its press', function () {
    const tracer = tick.createTracer(300);
    tracer.note({ kind: 'blur', at: PRESSED - 50, visible: true });
    tracer.start(1, PRESSED);
    tracer.note({ kind: 'button', at: PRESSED, disabled: false, text: 'Download (10)' });
    tracer.note({ kind: 'clock', at: PRESSED + 500 });
    tracer.note({ kind: 'open', at: PRESSED + 1200, url: 'https://www.knauf.com/download?token=SECRET' });
    tracer.note({ kind: 'blur', at: PRESSED + 1500, visible: true });
    tracer.note({ kind: 'focus', at: PRESSED + 6000, hasFocus: true, visible: true });
    tracer.start(2, PRESSED + 10000);
    tracer.note({ kind: 'visibility', at: PRESSED + 10250, visible: false });
    const traces = tracer.all();
    assert.deepStrictEqual(Object.keys(traces), ['1', '2']);
    assert.strictEqual(traces['1'].length, 4);
    assert.ok(/^\+0ms button/.test(traces['1'][0]), traces['1'][0]);
    assert.ok(/^\+1200ms /.test(traces['1'][1]), traces['1'][1]);
    assert.ok(/^\+6000ms focus/.test(traces['1'][3]), traces['1'][3]);
    assert.ok(/^\+250ms /.test(traces['2'][0]), traces['2'][0]);
    assert.ok(traces['1'].every(function (line) { return !/SECRET/.test(line); }));
    const out = tick.buildExport([tick.emptyLedger(KEY)], { at: TEN, traces: traces });
    assert.deepStrictEqual(out.traces, traces);
    assert.ok(/trace/i.test(out.reading));
    const capped = tick.createTracer(2);
    capped.start(1, 0);
    [1, 2, 3].forEach(function (at) { capped.note({ kind: 'unload', at: at }); });
    assert.strictEqual(capped.all()['1'].length, 2);
});

test('window.open, a form submitted and a frame given an address are reported, and pass through', function () {
    const notes = [];
    const opened = { name: 'a new window' };
    let submitted = 0;
    let requested = 0;
    function Form() { this.action = 'https://www.knauf.com/download?token=SECRET'; this.method = 'post'; }
    Form.prototype.submit = function () { submitted++; return 'submitted'; };
    Form.prototype.requestSubmit = function () { requested++; return 'requested'; };
    function Frame() { this.stored = ''; this.attrs = {}; }
    Object.defineProperty(Frame.prototype, 'src', {
        get: function () { return this.stored; },
        set: function (value) { this.stored = String(value); },
        configurable: true, enumerable: true
    });
    Frame.prototype.setAttribute = function (name, value) { this.attrs[name] = value; return 'set'; };
    const scope = {
        open: function () { return opened; },
        HTMLFormElement: Form,
        HTMLIFrameElement: Frame
    };
    const done = tick.installStartWrappers(scope, {
        tag: function () { return 4; },
        now: function () { return PRESSED + 10; },
        base: function () { return PAGE; },
        note: function (event) { notes.push(event); }
    });
    assert.deepStrictEqual(tick.installStartWrappers({}, {}), { open: false, submit: false, frame: false });
    assert.strictEqual(done.open, true);
    assert.strictEqual(done.submit, true);
    assert.strictEqual(done.frame, true);
    assert.strictEqual(scope.open('https://www.knauf.com/download?ids=1', '_blank'), opened);
    const form = new Form();
    assert.strictEqual(form.submit(), 'submitted');
    assert.strictEqual(form.requestSubmit(), 'requested');
    const frame = new Frame();
    frame.src = 'https://www.knauf.com/download?ids=2';
    assert.strictEqual(frame.src, 'https://www.knauf.com/download?ids=2');
    assert.strictEqual(frame.setAttribute('src', 'https://www.knauf.com/download?ids=3'), 'set');
    assert.strictEqual(frame.setAttribute('title', 'x'), 'set');
    assert.strictEqual(submitted, 1);
    assert.strictEqual(requested, 1);
    assert.deepStrictEqual(notes.map(function (each) { return each.kind; }),
        ['open', 'submit', 'submit', 'iframe', 'iframe']);
    assert.ok(notes.every(function (each) { return each.batch === 4 && each.at === PRESSED + 10; }));
    assert.strictEqual(tick.observe(watching(4), notes[0]).status, 'waiting');
    // A fault in the bookkeeping never reaches the page here either.
    const boom = function () { throw new Error('bookkeeping fault'); };
    const second = { open: function () { return opened; } };
    tick.installStartWrappers(second, { tag: function () { return 1; }, now: boom, base: boom, note: boom });
    assert.strictEqual(second.open('https://www.knauf.com/x'), opened);
});

/* ------------------------------------------------------------------ */
/* Version 3.3: a thousand rows, read cheaply, and no time wasted      */
/* ------------------------------------------------------------------ */

// A page of a thousand rows whose elements COUNT what is read of them:
// textContent and innerText per element, and firstChild (a text walk).
function countingDocument(count) {
    const reads = { text: new Map(), inner: 0, walks: new Map() };
    function bump(map, node) { map.set(node, (map.get(node) || 0) + 1); }
    function TextNode(value, parent) {
        this.nodeType = 3; this.nodeName = '#text'; this.nodeValue = value;
        this.parentElement = parent; parent.kids.push(this);
    }
    function Elem(tag, parent, attrs) {
        this.nodeType = 1; this.nodeName = tag.toUpperCase(); this.tagName = this.nodeName;
        this.kids = []; this.parentElement = parent || null; this.hidden = false;
        this.checked = false; this.type = (attrs && attrs.type) || '';
        this.attrs = attrs || {};
        if (parent) { parent.kids.push(this); }
    }
    Elem.prototype.getAttribute = function (name) {
        return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
    };
    const siblingOf = function (node) {
        const kids = node.parentElement ? node.parentElement.kids : [];
        return kids[kids.indexOf(node) + 1] || null;
    };
    Object.defineProperty(TextNode.prototype, 'nextSibling', { get: function () { return siblingOf(this); } });
    Object.defineProperty(Elem.prototype, 'nextSibling', { get: function () { return siblingOf(this); } });
    Object.defineProperty(Elem.prototype, 'firstChild', {
        get: function () { bump(reads.walks, this); return this.kids[0] || null; }
    });
    const plain = function (node) {
        return node.kids.map(function (kid) { return kid.nodeType === 3 ? kid.nodeValue : plain(kid); }).join('');
    };
    Object.defineProperty(Elem.prototype, 'textContent', {
        get: function () { bump(reads.text, this); return plain(this); }
    });
    Object.defineProperty(Elem.prototype, 'innerText', {
        get: function () { reads.inner++; return plain(this); }
    });
    Object.defineProperty(Elem.prototype, 'isConnected', {
        get: function () { let at = this; while (at.parentElement) { at = at.parentElement; } return at === body; }
    });
    Elem.prototype.contains = function (other) {
        for (let at = other; at; at = at.parentElement) { if (at === this) { return true; } }
        return false;
    };
    Elem.prototype.click = function () { if (this.type === 'checkbox') { this.checked = !this.checked; } };
    Elem.prototype.querySelectorAll = function (selector) {
        const onlyTicked = /:checked$/.test(selector);
        const out = [];
        (function walk(node) {
            node.kids.forEach(function (kid) {
                if (kid.nodeType !== 1) { return; }
                if (kid.nodeName === 'INPUT' && kid.type === 'checkbox' && (!onlyTicked || kid.checked)) {
                    out.push(kid);
                }
                walk(kid);
            });
        })(this);
        return out;
    };
    const body = new Elem('body', null);
    // A filter panel: several boxes in one container that also names a
    // format and a size, which is a list of filters, not a document row.
    const filters = new Elem('div', body);
    ['PDF', 'Under 1 MB', 'Over 1 MB'].forEach(function (name) {
        const label = new Elem('label', filters);
        new Elem('input', label, { type: 'checkbox' });
        new TextNode(name, label);
    });
    const list = new Elem('ul', body);
    const rows = [];
    function addRow(n) {
        const li = new Elem('li', list);
        new Elem('input', li, { type: 'checkbox' });
        new TextNode('DriTherm Cavity Slab ' + n, new Elem('div', li));
        new TextNode('Declaration of Performance', new Elem('div', li));
        new TextNode('PDF', new Elem('span', li));
        new TextNode(' ', li);
        new TextNode((200 + n) + ' KB', new Elem('span', li));
        rows.push(li);
        return li;
    }
    for (let n = 1; n <= count; n++) { addRow(n); }
    // Knauf Insulation's certificates list: a box, a title, the type as a
    // media type, a date and a language, and no size.
    function addTypedRow(title) {
        const tr = new Elem('tr', list);
        new Elem('input', new Elem('td', tr), { type: 'checkbox' });
        new TextNode(title, new Elem('td', tr));
        new TextNode('application/pdf', new Elem('td', tr));
        new TextNode('September 2026', new Elem('td', tr));
        new TextNode('English', new Elem('td', tr));
        rows.push(tr);
        return tr;
    }
    // A filter panel of its own with one box, naming a media type.
    function addLoneFilter(text) {
        const panel = new Elem('div', body);
        const label = new Elem('label', new Elem('div', panel));
        new Elem('input', label, { type: 'checkbox' });
        new TextNode(text, label);
        return label;
    }
    // Knauf Insulation's EPD list: a box, a PDF icon drawn as a picture,
    // the products as one link, then technology, plant, lambda, thickness
    // and expiry; no format word and no size anywhere in its text.
    function addEpdRow(title, icon) {
        const tr = new Elem('tr', list);
        new Elem('input', new Elem('td', tr), { type: 'checkbox' });
        const pic = new Elem('td', tr);
        if (icon) { new Elem('img', pic, { src: icon, alt: '' }); }
        new TextNode(title, new Elem('a', new Elem('td', tr), { href: '/epd/view/' + rows.length }));
        ['Glass Mineral Wool', 'St. Helens', '0,035', '100 mm', '2028-10-20'].forEach(function (cell) {
            new TextNode(cell, new Elem('td', tr));
        });
        rows.push(tr);
        return tr;
    }
    // A row the script cannot read: a box beside a few words and nothing
    // that names a file.
    function addPlainRow(words) {
        const div = new Elem('div', list);
        new Elem('input', new Elem('span', div), { type: 'checkbox' });
        new TextNode(words, new Elem('span', div));
        return div;
    }
    // Knauf Insulation's EPD list as the owner's 3.11 report showed it: a
    // div for a row, the box two divs down, the icon's word "pdf" as text,
    // and a link whose address names no file.
    function addDivRow(title) {
        const row = new Elem('div', list);
        new Elem('input', new Elem('div', new Elem('div', row)), { type: 'checkbox' });
        new TextNode('pdf', new Elem('span', row));
        new TextNode(title, new Elem('a', new Elem('div', row), { href: '/download/' + rows.length }));
        ['Rock Mineral Wool', 'Nova Bana', '0,035', '100 mm', '2027-05-29'].forEach(function (cell) {
            new TextNode(cell, new Elem('div', row));
        });
        rows.push(row);
        return row;
    }
    // A filter panel of one box and a link, as on the same page.
    function addLinkedFilter(words) {
        const li = new Elem('li', new Elem('ul', new Elem('aside', body)));
        new Elem('input', new Elem('div', li), { type: 'checkbox' });
        new TextNode(words, new Elem('a', li, { href: '?technologies=3154' }));
        return li;
    }
    const doc = { querySelectorAll: function (selector) { return body.querySelectorAll(selector); } };
    return {
        doc: doc,
        rows: rows,
        filters: filters,
        reads: reads,
        addRow: addRow,
        addTypedRow: addTypedRow,
        addLoneFilter: addLoneFilter,
        addEpdRow: addEpdRow,
        addPlainRow: addPlainRow,
        addDivRow: addDivRow,
        addLinkedFilter: addLinkedFilter,
        boxOf: function (row) { return row.kids[0]; },
        reset: function () { reads.text.clear(); reads.walks.clear(); reads.inner = 0; },
        textReads: function (node) { return reads.text.get(node) || 0; },
        walks: function (node) { return reads.walks.get(node) || 0; },
        // The page's own Download button: its count is the boxes ticked,
        // answered at once (or after a delay on a given clock).
        button: function (clock, lag) {
            return {
                disabled: false,
                getAttribute: function () { return null; },
                get innerText() {
                    const ticked = body.querySelectorAll('input[type="checkbox"]:checked')
                        .filter(function (box) { return box.parentElement.nodeName === 'LI'; }).length;
                    const shown = !lag || clock() >= lag.after ? ticked : 0;
                    return 'Download (' + shown + ')';
                }
            };
        }
    };
}

test('reading a thousand rows reads each row\'s text once, never innerText, and walks no row twice', function () {
    const page = countingDocument(1000);
    const reader = tick.createRowReader(page.doc, { now: function () { return 0; } });
    const first = reader.rows();
    assert.strictEqual(first.length, 1000);
    assert.strictEqual(page.reads.inner, 0);
    assert.ok(page.rows.every(function (row) { return page.textReads(row) === 1; }),
        'a row read more than once');
    assert.strictEqual(first[0].identity.id, 'dritherm cavity slab 1 declaration of performance pdf 201 kb');
    page.reset();
    const again = reader.rows();
    assert.deepStrictEqual(ids(again.map(function (each) { return each.identity; })),
        ids(first.map(function (each) { return each.identity; })));
    assert.ok(page.rows.every(function (row) {
        return page.textReads(row) === 1 && page.walks(row) === 0;
    }), 'the second read walked a row again, or read its text twice');
    assert.strictEqual(page.reads.inner, 0);
});

test('a row whose text changes is read afresh, a new row is found, and a box among many is not a row', function () {
    const page = countingDocument(3);
    const reader = tick.createRowReader(page.doc, { now: function () { return 0; } });
    assert.strictEqual(reader.rows().length, 3);
    page.rows[1].kids[1].kids[0].nodeValue = 'Rocksilk RainScreen Slab';
    page.addRow(4);
    const later = reader.rows();
    assert.deepStrictEqual(later.map(function (each) { return each.identity.title; }), [
        'DriTherm Cavity Slab 1 / Declaration of Performance',
        'Rocksilk RainScreen Slab / Declaration of Performance',
        'DriTherm Cavity Slab 3 / Declaration of Performance',
        'DriTherm Cavity Slab 4 / Declaration of Performance'
    ]);
    // The filter boxes sit together under text naming a format and a size;
    // that container holds three boxes, so none of them is a document row.
    assert.ok(later.every(function (each) { return each.row.nodeName === 'LI'; }));
});

test('ticked strays are cleared through the boxes the page reports ticked, and a ticked filter is left alone', async function () {
    const page = countingDocument(20);
    const reader = tick.createRowReader(page.doc, { now: function () { return 0; } });
    const rows = reader.rows();
    const filterBox = page.filters.kids[0].kids[0];
    filterBox.checked = true;
    page.boxOf(page.rows[15]).checked = true;
    let clock = 0;
    const taken = await tick.takeSelection(rows.slice(0, 10), {
        rows: reader.rows, locate: reader.locate, checked: reader.checked,
        button: function () { return page.button(function () { return clock; }); },
        sleep: function (seconds) { clock += seconds * 1000; return Promise.resolve(); },
        now: function () { return clock; }, halted: function () { return false; }
    });
    assert.strictEqual(taken.ok, true);
    assert.strictEqual(page.boxOf(page.rows[15]).checked, false);
    assert.strictEqual(filterBox.checked, true);
    assert.ok(page.rows.slice(0, 10).every(function (row) { return page.boxOf(row).checked; }));
});

test('the selection is checked at once and then every 50 ms, never after a fixed pause', async function () {
    const page = countingDocument(30);
    const reader = tick.createRowReader(page.doc, { now: function () { return 0; } });
    const rows = reader.rows();
    let clock = 0;
    const sleeps = [];
    const env = {
        rows: reader.rows, locate: reader.locate, checked: reader.checked,
        sleep: function (seconds) { sleeps.push(seconds); clock += seconds * 1000; return Promise.resolve(); },
        now: function () { return clock; }, halted: function () { return false; }
    };
    env.button = function () { return page.button(function () { return clock; }); };
    const atOnce = await tick.takeSelection(rows.slice(0, 10), env);
    assert.strictEqual(atOnce.ok, true);
    assert.deepStrictEqual(sleeps, []);
    rows.slice(0, 10).forEach(function (each) { each.box.checked = false; });
    // A page that shows the count 120 ms after the ticks.
    const lag = { after: clock + 120 };
    env.button = function () { return page.button(function () { return clock; }, lag); };
    const started = clock;
    const lagging = await tick.takeSelection(rows.slice(10, 20), env);
    assert.strictEqual(lagging.ok, true);
    assert.ok(clock - started <= 150, 'took ' + (clock - started) + ' ms');
    assert.ok(sleeps.every(function (each) { return each === 0.05; }), JSON.stringify(sleeps));
});

test('from a hand-over to the next press on a thousand rows, the script spends under 0.3 s of its own and reads each row once', async function () {
    const page = countingDocument(1000);
    const reader = tick.createRowReader(page.doc, { now: function () { return 0; } });
    let clock = 0;
    const timings = [];
    let handedAt = null;
    let pressedAt = null;
    let runner = null;
    const fakePage = {
        rows: reader.rows,
        take: function (chosen, halted) {
            return tick.takeSelection(chosen, {
                rows: reader.rows, locate: reader.locate, checked: reader.checked,
                button: function () { return page.button(function () { return clock; }); },
                sleep: function (seconds) { clock += seconds * 1000; return Promise.resolve(); },
                now: function () { return clock; }, halted: halted
            });
        },
        press: function (button, batch, timeout, timing) {
            timings.push(timing);
            if (batch === 1) {
                page.reset();
                handedAt = process.hrtime.bigint();
            } else {
                pressedAt = process.hrtime.bigint();
                runner.pause();
            }
            return Promise.resolve(CONFIRMED);
        },
        abortWait: function () {},
        untick: function (chosen) { tick.untickChosen(chosen, { rows: reader.rows }); },
        usable: function () { return true; }
    };
    const run = runnerFor(fakePage, {
        now: function () { return clock; },
        sleep: function (seconds) { clock += seconds * 1000; return Promise.resolve(); },
        settle: 1
    });
    runner = run.runner;
    await run.runner.play();
    assert.strictEqual(timings.length, 2);
    // On the page's clock: the settle of one second, and nothing else.
    assert.ok(timings[1].gapSeconds - 1 < 0.3, 'gap ' + timings[1].gapSeconds + 's');
    // In real time, the script's own work for a thousand rows.
    const realMs = Number(pressedAt - handedAt) / 1e6;
    assert.ok(realMs < 300, 'the script spent ' + realMs.toFixed(1) + ' ms');
    assert.strictEqual(page.reads.inner, 0);
    const chosenRows = new Set(timings[1] && page.rows.slice(10, 20));
    assert.ok(page.rows.every(function (row) {
        const read = page.textReads(row);
        return chosenRows.has(row) ? read >= 1 && read <= 6 : read === 1;
    }), 'a row was read more than its share');
    assert.ok(timings[1].readMs >= 0 && timings[1].takeMs >= 0 && timings[1].untickMs >= 0);
});

test('each step names itself, and each press says how long after the last hand-over it came', async function () {
    const page = runnerPage(numbered(15));
    let clock = 0;
    const timings = [];
    const press = page.press;
    page.rows = (function (rowsOf) {
        return function () { clock += 5; return rowsOf(); };
    })(page.rows);
    const take = page.take;
    page.take = function (chosen, halted) { clock += 296; return take(chosen, halted); };
    page.press = function (button, batch, timeout, timing) {
        timings.push(timing);
        return press(button, batch);
    };
    const run = runnerFor(page, {
        now: function () { return clock; },
        sleep: function (seconds) { clock += seconds * 1000; return Promise.resolve(); },
        settle: 1
    });
    await run.runner.play();
    assert.strictEqual(timings[0].gapSeconds, null);
    // Batch 1 handed over at 301 ms (5 reading, 296 ticking); then the
    // settle of 1000, 5 reading and 296 ticking: pressed at 1602.
    assert.strictEqual(timings[1].gapSeconds, 1.301);
    assert.strictEqual(timings[1].after, 1);
    assert.strictEqual(timings[1].readMs, 5);
    assert.strictEqual(timings[1].takeMs, 296);
    assert.strictEqual(timings[1].settleMs, 1000);
    const said = run.seen.said.join('\n');
    // Adapted for the zapper: the status line stays short; the timings go
    // into each batch's trace instead.
    assert.ok(/^Reading rows/m.test(said), said);
    assert.ok(/^Batch 2: ticking 5/m.test(said), said);
    assert.ok(/^Batch 2: pressed/m.test(said), said);
    assert.ok(/^Batch 1 \u2713 0s/m.test(said), said);
    const line = tick.describeEvent(Object.assign({ kind: 'timing', at: 0 }, timings[1]));
    assert.ok(/rows read in 5 ms/.test(line) && /ticked and checked in 296 ms/.test(line)
        && /1\.30s after batch 1 was handed over/.test(line), line);
});

test('between batches the run waits only the settle time, one second', async function () {
    const page = runnerPage(numbered(15));
    const sleeps = [];
    const run = runnerFor(page, {
        sleep: function (seconds) { sleeps.push(seconds); return Promise.resolve(); },
        settle: tick.DEFAULT_SETTLE
    });
    await run.runner.play();
    assert.deepStrictEqual(sleeps, [1, 1]);
});

test('a row the page has hidden is not ticked, and the batch fills from the rows after it', async function () {
    const page = runnerPage(numbered(12));
    const hidden = page.rows()[2].identity.id;
    page.usable = function (row) { return row.identity.id !== hidden; };
    const run = runnerFor(page);
    await run.runner.play();
    assert.strictEqual(page.presses[0].ids.length, 10);
    assert.strictEqual(page.presses[0].ids.indexOf(hidden), -1);
    assert.strictEqual(page.presses[1].ids.length, 1);
    assert.strictEqual(page.presses.length, 2);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(run.store.read().rows, hidden), false);
});

/* ------------------------------------------------------------------ */
/* Version 3.3: start at row                                          */
/* ------------------------------------------------------------------ */

test('a start of 21 on a 40-row page ticks rows 21 to 40 only', async function () {
    const page = runnerPage(numbered(40));
    const run = runnerFor(page, { startAt: 21 });
    await run.runner.play();
    const all = ids(page.rows().map(function (each) { return each.identity; }));
    assert.deepStrictEqual(page.presses.map(function (each) { return each.ids; }),
        [all.slice(20, 30), all.slice(30, 40)]);
    const ledger = run.store.read();
    assert.ok(all.slice(0, 20).every(function (id) {
        return !Object.prototype.hasOwnProperty.call(ledger.rows, id);
    }), 'a row above the start was recorded');
    assert.ok(/^Done: 2 batch\(es\)\./.test(lastSaid(run)), lastSaid(run));
});

test('a start past the last row says so plainly, and presses nothing', async function () {
    const page = runnerPage(numbered(10));
    const run = runnerFor(page, { startAt: 21 });
    await run.runner.play();
    assert.strictEqual(page.presses.length, 0);
    assert.ok(/No row 21: this page has 10/.test(lastSaid(run)), lastSaid(run));
    assert.strictEqual(run.seen.saves.length, 0);
});

test('Load more is pressed to reach the start row', async function () {
    const page = runnerPage(numbered(10));
    let calls = 0;
    page.loadMore = function () {
        calls++;
        if (calls === 1) {
            addRows(page, numbered(30).slice(10));
            return Promise.resolve({ pressed: true, grew: true, before: 10, after: 30 });
        }
        return Promise.resolve({ pressed: false, grew: false, before: 30, after: 30 });
    };
    const run = runnerFor(page, { startAt: 15 });
    await run.runner.play();
    const all = ids(page.rows().map(function (each) { return each.identity; }));
    assert.deepStrictEqual(page.presses.map(function (each) { return each.ids; }),
        [all.slice(14, 24), all.slice(24, 30)]);
});

test('the retry pass ignores unconfirmed rows above the start', async function () {
    const page = runnerPage(numbered(6));
    const run = runnerFor(page);
    const above = page.rows().slice(0, 3).map(function (each) { return each.identity; });
    run.store.record(above, run.store.nextBatch(), 'unconfirmed', NINE, { reason: 'timeout' });
    const later = runnerFor(page, { storage: run.storage, startAt: 4 });
    await later.runner.play();
    assert.strictEqual(page.presses.length, 1);
    assert.deepStrictEqual(page.presses[0].ids, ids(page.rows().slice(3).map(function (each) {
        return each.identity;
    })));
    assert.deepStrictEqual(tick.ledgerCounts(later.store.read()), { confirmed: 3, unconfirmed: 3 });
});

test('the start row is remembered per site, and a storage that refuses it loses nothing else', function () {
    const storage = fakeStorage();
    const key = tick.startKey('https://www.knauf.com/en-GB/download-centre?page=2');
    assert.strictEqual(key, tick.startKey('https://www.knauf.com/elsewhere'));
    assert.notStrictEqual(key, tick.startKey('https://www.knauf.de/en-GB/download-centre'));
    assert.strictEqual(tick.readStart(storage, key), 1);
    assert.strictEqual(tick.writeStart(storage, key, 21), true);
    assert.strictEqual(tick.readStart(storage, key), 21);
    ['0', '-4', 'twenty', '', '2.5'].forEach(function (raw) {
        storage.setItem(key, raw);
        assert.strictEqual(tick.readStart(storage, key), raw === '2.5' ? 2 : 1, raw);
    });
    assert.strictEqual(tick.readStart(refusingStorage(), key), 1);
    assert.strictEqual(tick.writeStart(refusingStorage(), key, 5), false);
});

/* ------------------------------------------------------------------ */
/* Version 3.5: which file types a run takes                          */
/* ------------------------------------------------------------------ */

// A page whose rows offer different file types: each entry a title and
// the type its row shows.
function mixedPage(entries) {
    const page = runnerPage([]);
    const rows = page.rows();
    tick.identitiesFor(entries.map(function (pair) {
        return pair[0] + '\nTechnical Drawing\n' + pair[1] + '\n338.14 kB';
    })).forEach(function (identity) {
        rows.push({ identity: identity, box: { checked: false } });
    });
    return page;
}

function typed(format, count, from) {
    return Array.from({ length: count }, function (_, at) {
        return [format + ' drawing ' + ((from || 1) + at), format];
    });
}

function idsOfType(page, format) {
    return page.rows().filter(function (each) { return each.identity.format === format; })
        .map(function (each) { return each.identity.id; });
}

test('a run takes only the file types switched on, and leaves the rest to do', async function () {
    const page = mixedPage(typed('PDF', 6).concat(typed('DWG', 4), typed('PDF', 6, 7),
        typed('DWG', 4, 5)));
    const run = runnerFor(page, { formats: ['DWG'] });
    await run.runner.play();
    const dwg = idsOfType(page, 'DWG');
    assert.deepStrictEqual(page.presses.map(function (each) { return each.ids; }), [dwg]);
    assert.deepStrictEqual(Object.keys(run.store.read().rows).sort(), dwg.slice().sort());
    assert.ok(/12 of other file types left/.test(lastSaid(run)),
        lastSaid(run));
    assert.ok(run.seen.said.some(function (line) { return /DWG only/.test(line); }),
        run.seen.said.join('\n'));
});

test('with every file type switched off, Play fetches nothing and presses no Load more', async function () {
    const page = mixedPage(typed('PDF', 3));
    let loads = 0;
    page.loadMore = function () {
        loads++;
        return Promise.resolve({ pressed: false, grew: false, before: 3, after: 3 });
    };
    const run = runnerFor(page, { formats: [] });
    await run.runner.play();
    assert.strictEqual(page.presses.length, 0);
    assert.strictEqual(loads, 0);
    assert.ok(/No file type switched on/.test(lastSaid(run)), lastSaid(run));
    assert.strictEqual(run.seen.saves.length, 0);
});

test('a file type switched off during a run is left alone from the next batch', async function () {
    const page = mixedPage(typed('PDF', 10).concat(typed('DWG', 5), typed('PDF', 5, 11)));
    let chosen = null;
    const press = page.press;
    page.press = function (button, batch) {
        chosen = ['DWG'];
        return press(button, batch);
    };
    const run = runnerFor(page, { formats: function () { return chosen; } });
    await run.runner.play();
    const all = ids(page.rows().map(function (each) { return each.identity; }));
    assert.deepStrictEqual(page.presses.map(function (each) { return each.ids; }),
        [all.slice(0, 10), all.slice(10, 15)]);
});

test('every type is taken until one is switched off; then only those on, and a new type starts off', function () {
    assert.strictEqual(tick.wantsFormat(null, 'DWG'), true);
    assert.strictEqual(tick.wantsFormat(null, 'RVT'), true);
    const shown = ['PDF', 'DWG'];
    const off = tick.toggleFormat(null, 'DWG', shown);
    assert.deepStrictEqual(off, ['PDF']);
    assert.strictEqual(tick.wantsFormat(off, 'PDF'), true);
    assert.strictEqual(tick.wantsFormat(off, 'pdf'), true);
    assert.strictEqual(tick.wantsFormat(off, 'DWG'), false);
    // A type first seen after Load more starts off while a choice is in force.
    assert.strictEqual(tick.wantsFormat(off, 'RVT'), false);
    // Every type shown switched back on is every type again.
    assert.strictEqual(tick.toggleFormat(off, 'DWG', shown), null);
    // The last one switched off leaves nothing on.
    assert.deepStrictEqual(tick.toggleFormat(off, 'PDF', shown), []);
    // A choice keeps a type the page does not show now.
    assert.deepStrictEqual(tick.toggleFormat(['PDF', 'RVT'], 'PDF', shown), ['RVT']);
});

test('the switches name each type on the page with how many rows offer it, most first', function () {
    const page = mixedPage(typed('PDF', 2).concat(typed('DWG', 3), typed('ZIP', 2)));
    assert.deepStrictEqual(tick.formatCounts(page.rows().map(function (each) {
        return each.identity;
    })), [{ format: 'DWG', rows: 3 }, { format: 'PDF', rows: 2 }, { format: 'ZIP', rows: 2 }]);
});

test('the status line says plainly which file types will be fetched', function () {
    assert.ok(/^Every file type/.test(tick.describeFormats(null)));
    assert.ok(/^No file type switched on/.test(tick.describeFormats([])));
    assert.strictEqual(tick.describeFormats(['PDF']), 'Only PDF.');
    assert.strictEqual(tick.describeFormats(['PDF', 'DWG', 'ZIP']), 'Only PDF, DWG and ZIP.');
});

test('the file types are remembered per site, and anything stored that is not a list reads as every type', function () {
    const storage = fakeStorage();
    const key = tick.formatsKey('https://www.knauf.com/en-GB/download-centre?page=2');
    assert.strictEqual(key, tick.formatsKey('https://www.knauf.com/elsewhere'));
    assert.notStrictEqual(key, tick.formatsKey('https://www.knauf.de/en-GB/download-centre'));
    assert.strictEqual(tick.readFormats(storage, key), null);
    assert.strictEqual(tick.writeFormats(storage, key, ['PDF', 'DWG']), true);
    assert.deepStrictEqual(tick.readFormats(storage, key), ['PDF', 'DWG']);
    assert.strictEqual(tick.writeFormats(storage, key, []), true);
    assert.deepStrictEqual(tick.readFormats(storage, key), []);
    assert.strictEqual(tick.writeFormats(storage, key, null), true);
    assert.strictEqual(tick.readFormats(storage, key), null);
    ['{"PDF":1}', 'not json', '"PDF"', '7'].forEach(function (stored) {
        storage.setItem(key, stored);
        assert.strictEqual(tick.readFormats(storage, key), null, stored);
    });
    storage.setItem(key, '["pdf", 7, "nonsense", "DWG"]');
    assert.deepStrictEqual(tick.readFormats(storage, key), ['PDF', 'DWG']);
    assert.strictEqual(tick.readFormats(refusingStorage(), key), null);
    assert.strictEqual(tick.writeFormats(refusingStorage(), key, ['PDF']), false);
});

/* ------------------------------------------------------------------ */
/* Version 3.6: Add to zip, for a site with no boxes (Tarmac)          */
/* ------------------------------------------------------------------ */

test('an Add to zip control is known by its words, and so is one already in the zip', function () {
    ['Add to zip', 'Add to zip +', 'ADD TO BASKET', 'Add to your downloads', 'Add to selection']
        .forEach(function (words) { assert.ok(tick.isAddText(words), words); });
    ['Download zip', 'Add', 'Add to zip and then download every document on the page',
        'Remove from zip', 'Clear all'].forEach(function (words) {
        assert.ok(!tick.isAddText(words), words);
    });
    ['Remove from zip', 'Added', 'Added to zip', 'In your zip', 'Remove from basket']
        .forEach(function (words) { assert.ok(tick.isInZipText(words), words); });
    ['Remove filter', 'Clear all', 'Add to zip', 'Document Type: Certificates']
        .forEach(function (words) { assert.ok(!tick.isInZipText(words), words); });
});

test('the zip ledger is kept per origin and path, and anything stored that is not one reads as empty', function () {
    const key = tick.zipLedgerKey('https://www.tarmac.com/downloads/?dl1_dt=352');
    assert.strictEqual(key, tick.zipLedgerKey('https://www.tarmac.com/downloads/?dl1_dt=352&pg=3#top'));
    assert.notStrictEqual(key, tick.ledgerKey('https://www.tarmac.com/downloads/'));
    const storage = fakeStorage();
    const store = tick.openZipStore(storage, key);
    store.record({ id: 'iso 9001', title: 'ISO 9001' }, 'added', 'its button now reads "Remove from zip"', TEN, '?pg=1');
    store.record({ id: 'ps1', title: 'BBA ps1' }, 'refused', 'not clickable', TEN, '?pg=1');
    const again = tick.openZipStore(storage, key).read();
    assert.deepStrictEqual(Object.keys(again.cards).sort(), ['iso 9001', 'ps1']);
    assert.strictEqual(again.cards['iso 9001'].status, 'added');
    assert.throws(function () { store.record({ id: 'x', title: 'x' }, 'maybe', '', TEN, ''); });
    ['not json', '[]', '{"cards":[]}', '{"cards":{"a":{"status":"done"}}}'].forEach(function (stored) {
        storage.setItem(key, stored);
        assert.deepStrictEqual(Object.keys(tick.openZipStore(storage, key).read().cards), [], stored);
    });
    const refused = tick.openZipStore(refusingStorage(), key);
    refused.record({ id: 'a', title: 'A' }, 'added', '', TEN, '');
    assert.strictEqual(refused.saved(), false);
    assert.strictEqual(refused.read().cards.a.status, 'added');
});

test('Play keeps adding on every page for two hours, and Stop ends it', function () {
    const storage = fakeStorage();
    const key = tick.zipAutoKey('https://www.tarmac.com/downloads/?dl1_dt=352');
    assert.strictEqual(key, tick.zipAutoKey('https://www.tarmac.com/elsewhere'));
    assert.strictEqual(tick.readZipAuto(storage, key, PRESSED), false);
    assert.strictEqual(tick.writeZipAuto(storage, key, true, PRESSED), true);
    assert.strictEqual(tick.readZipAuto(storage, key, PRESSED + 3600000), true);
    assert.strictEqual(tick.readZipAuto(storage, key, PRESSED + 3 * 3600000), false);
    assert.strictEqual(tick.writeZipAuto(storage, key, false, PRESSED), true);
    assert.strictEqual(tick.readZipAuto(storage, key, PRESSED + 1000), false);
    assert.strictEqual(tick.readZipAuto(refusingStorage(), key, PRESSED), false);
    assert.strictEqual(tick.writeZipAuto(refusingStorage(), key, true, PRESSED), false);
});

// A page of cards: each one's button words, whether it can be clicked, and
// what the page does when it is pressed ('added' turns its button into
// Remove from zip; 'silent' shows nothing).
function zipPage(specs) {
    const page = { pressed: [], paints: {}, cards: [] };
    page.add = function (list) {
        list.forEach(function (spec) {
            const card = {
                id: spec.id, title: spec.id, text: spec.words || 'Add to zip +',
                canClick: spec.clickable !== false, response: spec.response || 'added',
                words: function () { return card.text; },
                clickable: function () { return card.canClick; }
            };
            page.cards.push(card);
        });
    };
    page.add(specs);
    page.api = {
        cards: function () { return page.cards.slice(); },
        press: function (card) {
            page.pressed.push(card.id);
            if (page.onPress) { page.onPress(card); }
            if (card.response === 'added') {
                card.text = 'Remove from zip';
                return Promise.resolve({ added: true, why: 'its button now reads "Remove from zip"' });
            }
            return Promise.resolve({ added: false, why: 'no sign on the page that it was added' });
        },
        paint: function (card, status) { page.paints[card.id] = status; }
    };
    return page;
}

function zipRunnerFor(page, options) {
    const extra = options || {};
    const storage = extra.storage || fakeStorage();
    const store = tick.openZipStore(storage, tick.zipLedgerKey('https://www.tarmac.com/downloads/'));
    const seen = { said: [], auto: [], states: [] };
    const runner = tick.createZipRunner({
        page: page.api,
        store: store,
        sleep: function () { return Promise.resolve(); },
        gap: 0.3,
        iso: function () { return TEN; },
        where: function () { return '?pg=1'; },
        say: function (text) { seen.said.push(text); },
        showState: function (state) { seen.states.push(state); },
        setAuto: function (on) { seen.auto.push(on); },
        refresh: function () {},
        confirm: function () { return extra.answer === true; },
        limit: function () { return extra.limit === undefined ? 50 : extra.limit; },
        zipHolds: typeof extra.holds === 'function' ? extra.holds : function () { return null; }
    });
    return { runner: runner, store: store, storage: storage, seen: seen };
}

test('Play presses every clickable Add to zip on the page, and marks what it could not add', async function () {
    const page = zipPage([
        { id: 'c1' },
        { id: 'c2', clickable: false },
        { id: 'c3', response: 'silent' },
        { id: 'c4', words: 'Remove from zip' },
        { id: 'c5' },
        { id: 'c6', words: 'Download' }
    ]);
    const run = zipRunnerFor(page);
    await run.runner.play();
    assert.deepStrictEqual(page.pressed, ['c1', 'c3', 'c5']);
    assert.deepStrictEqual(page.paints, { c1: 'added', c2: 'refused', c3: 'silent', c4: 'added', c5: 'added' });
    const cards = run.store.read().cards;
    assert.deepStrictEqual(Object.keys(cards).sort(), ['c1', 'c2', 'c3', 'c4', 'c5']);
    assert.strictEqual(cards.c2.status, 'refused');
    assert.strictEqual(cards.c3.status, 'silent');
    assert.strictEqual(run.runner.state(), 'running');
    assert.deepStrictEqual(run.seen.auto, [true]);
    const summary = tick.zipSummary(tick.zipCounts(page.cards, run.store.read()), 4);
    assert.ok(/^6 items \u00b7 3 done \u00b7 1 to do \u00b7 1 not clickable \u00b7 1 no change \u00b7 4 on site$/
        .test(summary), summary);
    assert.ok(/^Page done\. Open the next page/.test(run.seen.said[run.seen.said.length - 1]));
});

test('a card added, or pressed with no sign, is never pressed again; one not clickable is tried again', async function () {
    const storage = fakeStorage();
    const first = zipPage([{ id: 'c1' }, { id: 'c2', clickable: false }, { id: 'c3', response: 'silent' }]);
    await zipRunnerFor(first, { storage: storage }).runner.play();
    // The same page after a reload: every button reads Add to zip again, and
    // c2 can now be clicked.
    const later = zipPage([{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }]);
    const run = zipRunnerFor(later, { storage: storage });
    await run.runner.play();
    assert.deepStrictEqual(later.pressed, ['c2']);
    assert.deepStrictEqual(later.paints, { c1: 'added', c2: 'added', c3: 'silent' });
});

test('while Play is on, a new page of cards is added as it appears; after Stop nothing is pressed', async function () {
    const page = zipPage([{ id: 'p1a' }, { id: 'p1b' }]);
    const run = zipRunnerFor(page);
    await run.runner.play();
    page.cards = [];
    page.add([{ id: 'p2a' }, { id: 'p2b' }]);
    await run.runner.pageChanged();
    assert.deepStrictEqual(page.pressed, ['p1a', 'p1b', 'p2a', 'p2b']);
    await run.runner.stop();
    assert.strictEqual(run.runner.state(), 'idle');
    assert.deepStrictEqual(run.seen.auto, [true, true, false]);
    page.cards = [];
    page.add([{ id: 'p3a' }]);
    await run.runner.pageChanged();
    assert.deepStrictEqual(page.pressed, ['p1a', 'p1b', 'p2a', 'p2b']);
});

test('cards that appear while a page is being added are added in the same run', async function () {
    const page = zipPage([{ id: 'a' }, { id: 'b' }]);
    const run = zipRunnerFor(page);
    page.onPress = function (card) {
        if (card.id === 'a') {
            page.add([{ id: 'late' }]);
            run.runner.pageChanged();
        }
    };
    await run.runner.play();
    assert.deepStrictEqual(page.pressed, ['a', 'b', 'late']);
});

test('Stop in the middle of a page presses nothing more', async function () {
    const page = zipPage([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    const run = zipRunnerFor(page);
    page.onPress = function (card) {
        if (card.id === 'a') { run.runner.stop(); }
    };
    await run.runner.play();
    assert.deepStrictEqual(page.pressed, ['a']);
    assert.strictEqual(run.store.read().cards.a.status, 'added');
});

test('Reset forgets the zip ledger only after a confirm, and never while adding', async function () {
    const page = zipPage([{ id: 'a' }]);
    const run = zipRunnerFor(page, { answer: true });
    await run.runner.play();
    assert.strictEqual(run.runner.reset(), false);
    await run.runner.stop();
    assert.strictEqual(run.runner.reset(), true);
    assert.deepStrictEqual(Object.keys(run.store.read().cards), []);
    const declined = zipRunnerFor(zipPage([{ id: 'a' }]), { answer: false });
    await declined.runner.play();
    await declined.runner.stop();
    assert.strictEqual(declined.runner.reset(), false);
    assert.deepStrictEqual(Object.keys(declined.store.read().cards), ['a']);
});

// THE OWNER'S ASK FOR 3.7: press on to the next page and keep going to
// the last, so the zip fills and is downloaded once at the end.
function pagedZip(pages) {
    const page = zipPage(pages[0]);
    page.at = 0;
    page.turns = 0;
    page.api.next = function () {
        page.turns += 1;
        if (page.onNext) { page.onNext(); }
        if (page.stuck) { return Promise.resolve({ pressed: true, changed: false }); }
        if (page.at + 1 >= pages.length) {
            return Promise.resolve({ pressed: false, why: 'no next page button' });
        }
        page.at += 1;
        page.cards = [];
        page.add(pages[page.at]);
        return Promise.resolve({ pressed: true, changed: true, how: 'the next button' });
    };
    return page;
}

test('Play goes on through every page by its next button, and stops itself at the last', async function () {
    const page = pagedZip([[{ id: 'a' }, { id: 'b' }], [{ id: 'c' }], [{ id: 'd' }, { id: 'e' }]]);
    const run = zipRunnerFor(page);
    await run.runner.play();
    assert.deepStrictEqual(page.pressed, ['a', 'b', 'c', 'd', 'e']);
    assert.strictEqual(page.turns, 3);
    assert.strictEqual(run.runner.state(), 'idle');
    assert.deepStrictEqual(run.seen.auto, [true, false]);
    const said = run.seen.said[run.seen.said.length - 1];
    assert.ok(/Done: last page/.test(said), said);
});

test('a next button that changes nothing is taken as the last page', async function () {
    const page = pagedZip([[{ id: 'a' }], [{ id: 'b' }]]);
    page.stuck = true;
    const run = zipRunnerFor(page);
    await run.runner.play();
    assert.deepStrictEqual(page.pressed, ['a']);
    assert.strictEqual(run.runner.state(), 'idle');
    assert.ok(/Done: last page/.test(run.seen.said[run.seen.said.length - 1]));
});

test('Stop while the next page loads adds nothing from it', async function () {
    const page = pagedZip([[{ id: 'a' }], [{ id: 'b' }]]);
    const run = zipRunnerFor(page);
    page.onNext = function () { run.runner.stop(); };
    await run.runner.play();
    assert.deepStrictEqual(page.pressed, ['a']);
    assert.strictEqual(run.runner.state(), 'idle');
    assert.deepStrictEqual(run.seen.auto, [true, false]);
});

test('a page whose cards are all added already is passed through, not stopped at', async function () {
    const storage = fakeStorage();
    await zipRunnerFor(zipPage([{ id: 'a' }, { id: 'b' }]), { storage: storage }).runner.play();
    const page = pagedZip([[{ id: 'a' }, { id: 'b' }], [{ id: 'c' }]]);
    const run = zipRunnerFor(page, { storage: storage });
    await run.runner.play();
    assert.deepStrictEqual(page.pressed, ['c']);
    assert.strictEqual(page.turns, 2);
});

// THE OWNER'S FIND FOR 3.8: Tarmac's zip of 141 documents failed to
// download at all, so a run stops at a limit he sets and carries on later.
test('Play stops when the zip reaches the limit, and the next Play carries on from there', async function () {
    const page = pagedZip([[{ id: 'a' }, { id: 'b' }, { id: 'c' }], [{ id: 'd' }, { id: 'e' }]]);
    const run = zipRunnerFor(page, { limit: 2 });
    await run.runner.play();
    assert.deepStrictEqual(page.pressed, ['a', 'b']);
    assert.strictEqual(run.runner.state(), 'idle');
    assert.deepStrictEqual(run.seen.auto, [true, false]);
    const said = run.seen.said[run.seen.said.length - 1];
    assert.ok(/Limit reached \(2\)/.test(said) && /Play/.test(said), said);
    assert.ok(!/last page/.test(said), said);
    await run.runner.play();
    assert.deepStrictEqual(page.pressed, ['a', 'b', 'c', 'd']);
    await run.runner.play();
    assert.deepStrictEqual(page.pressed, ['a', 'b', 'c', 'd', 'e']);
    assert.ok(/Done: last page/.test(run.seen.said[run.seen.said.length - 1]));
});

test('the site\'s own count of its zip is what the limit is held against, when it can be read', async function () {
    let holds = 3;
    const page = zipPage([{ id: 'a' }, { id: 'b' }]);
    const run = zipRunnerFor(page, { limit: 3, holds: function () { return holds; } });
    await run.runner.play();
    assert.deepStrictEqual(page.pressed, []);
    assert.ok(/Limit reached \(3\)/.test(run.seen.said[run.seen.said.length - 1]));
    // Downloaded and emptied: the site's count is back to nothing.
    holds = 0;
    page.onPress = function () { holds += 1; };
    await run.runner.play();
    assert.deepStrictEqual(page.pressed, ['a', 'b']);
});

test('the zip limit is remembered per site, and anything stored that is not a count reads as 50', function () {
    const storage = fakeStorage();
    const key = tick.zipLimitKey('https://www.tarmac.com/downloads/?dl1_dt=352');
    assert.strictEqual(key, tick.zipLimitKey('https://www.tarmac.com/elsewhere'));
    assert.strictEqual(tick.readZipLimit(storage, key), 50);
    assert.strictEqual(tick.writeZipLimit(storage, key, 40), true);
    assert.strictEqual(tick.readZipLimit(storage, key), 40);
    ['0', '-3', 'lots', ''].forEach(function (stored) {
        storage.setItem(key, stored);
        assert.strictEqual(tick.readZipLimit(storage, key), 50, stored);
    });
    assert.strictEqual(tick.readZipLimit(refusingStorage(), key), 50);
    assert.strictEqual(tick.writeZipLimit(refusingStorage(), key, 40), false);
});

test('a card whose button already reads as in the zip counts as added on the panel', function () {
    const cards = [{ id: 'a', words: function () { return 'Remove from zip'; } },
        { id: 'b', words: function () { return 'Add to zip'; } }];
    const ledger = { cards: {} };
    assert.deepStrictEqual(tick.zipCounts(cards, ledger, function (card) {
        return tick.isInZipText(card.words());
    }), { cards: 2, added: 1, refused: 0, silent: 0, todo: 1 });
    assert.strictEqual(tick.zipCounts(cards, ledger).todo, 2);
});

// Adapted in 3.8: the owner asked for a limit on how many go in one zip.
// (The panel test that stood here moved to tests/batch-panel.test.js: the zapper builds
// its panel from DOM nodes, not an HTML string.)

/* ------------------------------------------------------------------ */
/* Version 3.9: rows that name a media type and show no size           */
/* ------------------------------------------------------------------ */

// THE OWNER'S FIND, 2026-10-10: Knauf Insulation's certificates list
// shows "application/pdf", a date and a language, and no size, so the
// panel read 0 rows on a page of 22.
test('a row naming its type as a media type, with a title, is a document row though it shows no size', function () {
    assert.ok(tick.isDocumentRowText('Declare - Glass mineral wool products with Black woven veil '
        + 'with E-Technology Knauf Insulation\napplication/pdf\nSeptember 2026\nEnglish'));
    assert.ok(tick.isDocumentRowText('DECLARE - SUPAFIL Party Wall\napplication/pdf\nFebruary 2026'));
    assert.ok(tick.isDocumentRowText('Product 1\nDeclaration of Performance\nPDF\n245 KB'));
    ['application/pdf (22)', 'File type\napplication/pdf (22)', 'PDF', 'Declare',
        'Technical Drawing (130)', 'PDF\n(130)'].forEach(function (text) {
        assert.ok(!tick.isDocumentRowText(text), text);
    });
    const row = tick.rowIdentity('DECLARE - SUPAFIL Party Wall\napplication/pdf\nFebruary 2026\nEnglish');
    assert.strictEqual(row.format, 'PDF');
    assert.strictEqual(row.size, '');
    assert.strictEqual(row.title, 'DECLARE - SUPAFIL Party Wall / February 2026 / English');
});

test('the reader finds rows that name a media type, and passes over a lone filter box that names one', function () {
    const page = countingDocument(0);
    page.addTypedRow('Declare - Glass mineral wool products with Black woven veil');
    page.addTypedRow('DECLARE - SUPAFIL Party Wall');
    page.addLoneFilter('application/pdf (22)');
    const reader = tick.createRowReader(page.doc, { now: function () { return 0; } });
    const rows = reader.rows();
    assert.deepStrictEqual(rows.map(function (each) { return each.row.nodeName; }), ['TR', 'TR']);
    assert.deepStrictEqual(rows.map(function (each) { return each.identity.format; }), ['PDF', 'PDF']);
});

/* ------------------------------------------------------------------ */
/* Version 3.10: a row known by its links, its icons and its shape     */
/* ------------------------------------------------------------------ */

// THE OWNER'S FIND, 2026-10-10: Knauf Insulation's EPD list draws "PDF" as
// a picture and shows no size, so nothing in a row's text names a file.
const EPD_ROW = 'KI MULTIFIT 035, Naturoll 035, KI FIT 035\nGlass Mineral Wool\n'
    + 'Bernburg, Krupka\n0,035\n100 mm\n2028-09-07';

test('a row whose own link or icon names a document, or a table row with a link, is a document row', function () {
    assert.ok(tick.isDocumentRow(EPD_ROW, { tag: 'DIV', links: 0,
        signals: ['/themes/ki/images/icon-pdf.svg'] }));
    assert.ok(tick.isDocumentRow(EPD_ROW, { tag: 'LI', links: 1,
        signals: ['https://www.knaufinsulation.com/sites/default/files/EPD_Multifit.pdf'] }));
    assert.ok(tick.isDocumentRow(EPD_ROW, { tag: 'TR', links: 1, signals: ['/epd/view/3'] }));
    // As before, a row whose text names a format and a size needs nothing more.
    assert.ok(tick.isDocumentRow('Product 1\nDeclaration of Performance\nPDF\n245 KB', null));
});

test('a filter, a picture, an icon or a page link is not a document row', function () {
    // Neither a link nor an icon that names a document, and not a table row.
    assert.ok(!tick.isDocumentRow(EPD_ROW, { tag: 'DIV', links: 1, signals: ['/products/multifit'] }));
    // A thumbnail, an SVG icon and a step number name no document.
    assert.ok(!tick.isDocumentRow(EPD_ROW, { tag: 'DIV', links: 0,
        signals: ['svg-icon chevron', '/media/thumb.jpg', 'step-2', 'image.png'] }));
    // A filter's few words are not a title, whatever sits beside them.
    assert.ok(!tick.isDocumentRow('Glass Mineral Wool', { tag: 'LABEL', links: 0, signals: [] }));
    assert.ok(!tick.isDocumentRow('PDF', { tag: 'TR', links: 1, signals: ['icon-pdf'] }));
});

test('the reader finds rows by their icon or by their shape, and names the format an icon gives', function () {
    const page = countingDocument(0);
    page.addEpdRow('DriTherm Cavity Slab 32, FrameTherm Slab 32, OmniFit Slab 32', '/themes/ki/pdf-icon.svg');
    page.addEpdRow('OmniFit Slab 35, OmniFit Thermal and Sound Slab', '');
    page.addLoneFilter('Glass Mineral Wool');
    page.addLoneFilter('Blowing wool');
    const reader = tick.createRowReader(page.doc, { now: function () { return 0; } });
    const rows = reader.rows();
    assert.deepStrictEqual(rows.map(function (each) { return each.row.nodeName; }), ['TR', 'TR']);
    assert.deepStrictEqual(rows.map(function (each) { return each.identity.format; }), ['PDF', '']);
});

/* ------------------------------------------------------------------ */
/* Version 3.11: a page with no rows says what it holds                */
/* ------------------------------------------------------------------ */

test('Play on a page with no rows says none were found and what the page holds, not "no row 1"', async function () {
    const page = runnerPage([]);
    page.explainNoRows = function () { return 'The page has 23 checkboxes.'; };
    const run = runnerFor(page);
    await run.runner.play();
    const said = lastSaid(run);
    assert.ok(/^No rows found\. The page has 23 checkboxes\./.test(said), said);
    assert.ok(!/There is no row/.test(said), said);
    assert.strictEqual(page.presses.length, 0);
});

test('the reader says, level by level, why a box was not read as a document row', function () {
    const page = countingDocument(0);
    const row = page.addPlainRow('MPE');
    const reader = tick.createRowReader(page.doc, { now: function () { return 0; } });
    assert.strictEqual(reader.rows().length, 0);
    const why = reader.explain(row.kids[0].kids[0]);
    assert.ok(/SPAN ""/.test(why), why);
    assert.ok(/DIV "MPE": 3 letters, 0 link\(s\), no file named/.test(why), why);
    // The climb stops where a container holds more than one box.
    page.addPlainRow('Another');
    assert.ok(/holds 2 boxes, so the climb stops/.test(reader.explain(row.kids[0].kids[0])));
});

/* ------------------------------------------------------------------ */
/* Version 3.12: a row whose text names a document kind, with a link   */
/* ------------------------------------------------------------------ */

// THE OWNER'S 3.11 REPORT, knaufinsulation.com/download-epd-rock-mineral-
// wool: 124 boxes, one a filter, 123 rows each a DIV reading "pdf MPE Rock
// Mineral Wool Nova Bana 0,035 100 mm 2027-05-29", with one link and no
// file named in any attribute.
test('a row whose text names a document kind and holds a link is a document row, table or not', function () {
    const text = 'pdf\nMPE\nRock Mineral Wool\nNova Bana\n0,035\n100 mm\n2027-05-29';
    assert.ok(tick.isDocumentRow(text, { tag: 'DIV', links: 1, signals: ['/download/123'] }));
    // Without the link it is not enough.
    assert.ok(!tick.isDocumentRow(text, { tag: 'DIV', links: 0, signals: [] }));
    // A filter with a link names no document kind.
    assert.ok(!tick.isDocumentRow('Find your file\nTechnology\nRock Mineral Wool',
        { tag: 'ASIDE', links: 1, signals: ['?technologies=3154'] }));
    // A word that is a file type but no document kind is not enough.
    assert.ok(!tick.isDocumentRow('Step by step guide to fixing the boards',
        { tag: 'DIV', links: 1, signals: [] }));
});

test('the reader finds the EPD list\'s div rows and passes over its one filter', function () {
    const page = countingDocument(0);
    page.addLinkedFilter('Rock Mineral Wool');
    page.addDivRow('MPE');
    page.addDivRow('Power-tek LW STD');
    page.addDivRow('Thermo-teK BD 080 ALU');
    const reader = tick.createRowReader(page.doc, { now: function () { return 0; } });
    const rows = reader.rows();
    assert.strictEqual(rows.length, 3);
    assert.deepStrictEqual(rows.map(function (each) { return each.identity.format; }),
        ['PDF', 'PDF', 'PDF']);
    assert.ok(/^MPE \/ Rock Mineral Wool/.test(rows[0].identity.title), rows[0].identity.title);
});

/* ------------------------------------------------------------------ */
/* Version 3.13: Select all, and number boxes a page cannot crop        */
/* ------------------------------------------------------------------ */

// A row as the reader gives it, whose box ticks only when clicked and
// counts its clicks, so a box set rather than clicked shows.
function selectableRow(format, ticked, at) {
    const box = { checked: !!ticked, clicks: 0,
        click: function () { this.clicks += 1; this.checked = !this.checked; } };
    return { box: box, identity: { id: 'row ' + at, format: format } };
}

test('Select all takes the rows a run would: of the file types switched on, from the start row', function () {
    const live = ['PDF', 'DWG', 'PDF', 'PDF'].map(function (format, at) {
        return selectableRow(format, false, at);
    });
    assert.strictEqual(tick.rowsToSelect(live, null, 1).length, 4);
    assert.deepStrictEqual(tick.rowsToSelect(live, ['PDF'], 1), [live[0], live[2], live[3]]);
    assert.deepStrictEqual(tick.rowsToSelect(live, ['PDF'], 3), [live[2], live[3]]);
    assert.deepStrictEqual(tick.rowsToSelect(live, [], 1), []);
});

test('Select all ticks each row by clicking its box, never a box already ticked, and passes over a row the page hides', function () {
    const rows = [selectableRow('PDF', false, 0), selectableRow('PDF', true, 1),
        selectableRow('PDF', false, 2)];
    const hidden = rows[2];
    const done = tick.tickAll(rows, function (row) { return row !== hidden; });
    assert.deepStrictEqual(done, { untick: false, changed: 1, passed: 1, rows: 3 });
    assert.deepStrictEqual(rows.map(function (each) { return each.box.clicks; }), [1, 0, 0]);
    assert.deepStrictEqual(rows.map(function (each) { return each.box.checked; }),
        [true, true, false]);
});

test('pressed again once every row is ticked, Select all unticks them, and its label says which it will do', function () {
    const rows = [selectableRow('PDF', false, 0), selectableRow('DWG', false, 1)];
    assert.strictEqual(tick.selectAllLabel(rows), 'Select all');
    tick.tickAll(rows);
    assert.strictEqual(tick.selectAllLabel(rows), 'Untick all');
    const done = tick.tickAll(rows);
    assert.deepStrictEqual(done, { untick: true, changed: 2, passed: 0, rows: 2 });
    assert.ok(rows.every(function (each) { return each.box.checked === false; }));
    assert.strictEqual(tick.selectAllLabel(rows), 'Select all');
    // With no rows there is nothing to untick, so it offers to select.
    assert.strictEqual(tick.selectAllLabel([]), 'Select all');
});

test('the Select all report says how many stayed ticked, and sends a page that caps a selection to Play', function () {
    const all = tick.selectAllReport({ untick: false, changed: 123, passed: 0, rows: 123 }, 123,
        'Download selected files (123)');
    assert.ok(/^Selected 123 of 123\./.test(all), all);
    assert.ok(/"Download selected files \(123\)"/.test(all), all);
    const capped = tick.selectAllReport({ untick: false, changed: 123, passed: 0, rows: 123 }, 10,
        'Download (10)');
    assert.ok(/^Only 10 of 123 stayed ticked\./.test(capped), capped);
    assert.ok(/Press again/.test(capped) && /Play/.test(capped), capped);
    const hidden = tick.selectAllReport({ untick: false, changed: 3, passed: 2, rows: 5 }, 3, '');
    assert.ok(/^Selected 3 of 5 \(2 hidden, passed over\)\./.test(hidden), hidden);
    assert.ok(!/only/i.test(hidden), hidden);
    assert.strictEqual(tick.selectAllReport({ untick: true, changed: 4, passed: 0, rows: 4 }, 0, ''),
        'Unticked 4.');
    assert.ok(/stayed ticked/.test(tick.selectAllReport(
        { untick: true, changed: 4, passed: 0, rows: 4 }, 1, '')));
    assert.ok(/^No rows to select/.test(tick.selectAllReport(
        { untick: false, changed: 0, passed: 0, rows: 0 }, 0, '')));
});

// THE OWNER'S FIND, 2026-10-10: a page's own styles gave the panel's number
// boxes so much padding that a batch size of 10 showed as "1".
// (The panel test that stood here moved to tests/batch-panel.test.js: the zapper builds
// its panel from DOM nodes, not an HTML string.)

/* ------------------------------------------------------------------ */
/* Version 3.14: the page goes quiet before Download is pressed         */
/* ------------------------------------------------------------------ */

// THE OWNER'S KNAUF RUN, 2026-10-10: 39 rows in four batches came back
// as 35 files, and the one lost from each zip was always the LAST row
// ticked. 3.2 paused between steps and lost nothing; 3.3 pressed the
// moment the boxes read ticked and has lost one a batch since.
test('the page is quiet once nothing has changed for the quiet time since the later of its last change and the start', async function () {
    let clock = 0;
    const sleep = function (seconds) { clock += Math.round(seconds * 1000); return Promise.resolve(); };
    const now = function () { return clock; };
    // The page changes at 100, 400 and 900 ms, then stops.
    const changes = [100, 400, 900];
    const lastChange = function () {
        return changes.filter(function (at) { return at <= clock; }).reduce(function (a, b) {
            return Math.max(a, b); }, -1);
    };
    const calm = await tick.waitForQuiet(lastChange, 0, now, sleep, 1000, 6000);
    assert.strictEqual(calm.quiet, true);
    assert.ok(clock >= 1900 && clock < 1950, String(clock));
    assert.strictEqual(calm.waitedMs, clock);
    // A page that changed long ago still waits the quiet time from the start.
    clock = 5000;
    const idle = await tick.waitForQuiet(function () { return 0; }, 5000, now, sleep, 1000, 6000);
    assert.strictEqual(idle.quiet, true);
    assert.ok(clock >= 6000 && clock < 6050, String(clock));
});

test('a page that never stops changing is pressed at the ceiling, and Pause or Stop ends the wait', async function () {
    let clock = 0;
    const sleep = function (seconds) { clock += Math.round(seconds * 1000); return Promise.resolve(); };
    const now = function () { return clock; };
    const busy = await tick.waitForQuiet(now, 0, now, sleep, 1000, 6000);
    assert.strictEqual(busy.quiet, false);
    assert.strictEqual(busy.halted, false);
    assert.ok(clock >= 6000 && clock < 6050, String(clock));
    clock = 0;
    const stopped = await tick.waitForQuiet(now, 0, now, sleep, 1000, 6000,
        function () { return clock >= 500; });
    assert.strictEqual(stopped.halted, true);
    assert.ok(clock >= 500 && clock < 550, String(clock));
});

test('the run waits for the page to go quiet after ticking, takes the selection again, and only then presses', async function () {
    const page = runnerPage(['Alpha board 12.5 mm', 'Beta board 15 mm', 'Gamma board 9.5 mm']);
    const order = [];
    const take = page.take;
    page.take = function (chosen, halted) { order.push('take'); return take(chosen, halted); };
    const press = page.press;
    let timing = null;
    page.press = function (button, batch, timeout, given) {
        order.push('press');
        timing = given;
        return press(button, batch);
    };
    page.quiet = function () {
        order.push('quiet');
        return Promise.resolve({ quiet: true, halted: false, waitedMs: 1200 });
    };
    const run = runnerFor(page);
    await run.runner.play();
    assert.deepStrictEqual(order, ['take', 'quiet', 'take', 'press']);
    // Adapted for the zapper: the quiet time goes into the trace, not the status.
    assert.strictEqual(timing.quietMs, 1200);
    assert.strictEqual(timing.stillChanging, false);
    assert.ok(/page went quiet in 1200 ms/.test(
        tick.describeEvent(Object.assign({ kind: 'timing', at: 0 }, timing))));
});

test('a page still changing at the ceiling is pressed all the same, and the press line says so', async function () {
    const page = runnerPage(['Alpha board 12.5 mm']);
    let timing = null;
    const press = page.press;
    page.press = function (button, batch, timeout, given) { timing = given; return press(button, batch); };
    page.quiet = function () {
        return Promise.resolve({ quiet: false, halted: false, waitedMs: 6000 });
    };
    const run = runnerFor(page);
    await run.runner.play();
    assert.strictEqual(page.presses.length, 1);
    assert.strictEqual(timing.stillChanging, true);
    assert.strictEqual(timing.quietMs, 6000);
});

test('Pause pressed while the page settles puts the batch back, unticked and unrecorded', async function () {
    const page = runnerPage(['Alpha board 12.5 mm', 'Beta board 15 mm']);
    let run = null;
    page.quiet = function () {
        run.runner.pause();
        return Promise.resolve({ quiet: false, halted: true, waitedMs: 10 });
    };
    run = runnerFor(page);
    await run.runner.play();
    assert.strictEqual(page.presses.length, 0);
    assert.strictEqual(page.unticked, 2);
    assert.deepStrictEqual(tick.ledgerCounts(run.store.read()), { confirmed: 0, unconfirmed: 0 });
});

test('loading the batch modules draws nothing and wraps nothing', function () {
    assert.strictEqual(typeof globalThis.document, 'undefined');
    assert.strictEqual(typeof tick.observe, 'function');
});
