// =========================================================
// #329 — navigator.sendBeacon posts its JSON as text/plain (a "simple" request, no CORS preflight
// from the client origin to the gateway). Parse such a body as JSON; a JSON body is left as is.
// =========================================================
import express from 'express';

const text = express.text({ type: 'text/plain', limit: '1kb' });

/** @type {import('express').RequestHandler} */
export function beaconBody(req, res, next) {
  text(req, res, (err) => {
    if (err) return next(err);
    if (typeof req.body === 'string') {
      try {
        req.body = JSON.parse(req.body);
      } catch {
        req.body = {}; // validation answers 400
      }
    }
    next();
  });
}
