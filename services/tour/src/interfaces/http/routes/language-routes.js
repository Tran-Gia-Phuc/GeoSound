// =========================================================
// Định tuyến HTTP cho đa ngôn ngữ & TTS (UC12). Lồng dưới tour tác giả.
// Qua gateway: /api/tours/mine/:tourId/languages ...
// Mọi route yêu cầu JWT role=contributor.
// =========================================================
import { Router } from 'express';
import { verifyJwt } from '../../../../shared/middleware/index.js';
import { validateBody, validateParams } from '../middleware/validate.js';
import { tourIdParamSchema } from '../../../application/dtos/place-schemas.js';
import {
  setLanguagesSchema,
  previewTtsSchema,
  updateTranslationSchema,
  placeParamsSchema,
  translationParamsSchema,
} from '../../../application/dtos/language-schemas.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** @param {{ languageController }} deps */
export function buildLanguageRouter({ languageController }) {
  const r = Router();

  r.use(verifyJwt(['contributor']));

  r.get('/mine/:tourId/languages', validateParams(tourIdParamSchema), wrap(languageController.get));
  r.put('/mine/:tourId/languages', validateParams(tourIdParamSchema), validateBody(setLanguagesSchema), wrap(languageController.set));

  // A1 — nghe thử TTS; A2 — chỉnh bản dịch.
  r.post('/mine/:tourId/places/:placeId/tts-preview', validateParams(placeParamsSchema), validateBody(previewTtsSchema), wrap(languageController.preview));
  r.patch('/mine/:tourId/places/:placeId/translations/:lang', validateParams(translationParamsSchema), validateBody(updateTranslationSchema), wrap(languageController.updateTranslation));

  return r;
}
