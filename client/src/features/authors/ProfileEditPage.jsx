// =========================================================
// ProfileEditPage (/account/profile) — UC18 A1 (#119): any signed-in user edits
// their name (1–120), introduction (max 500, counter) and avatar. The avatar is
// uploaded through the Media upload (FileDrop), then its URL is saved with
// PATCH /api/auth/me/profile; "Gỡ" saves null. Only changed fields are sent.
// =========================================================
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../../components/Icon.jsx';
import AppHeader from '../../components/shell/AppHeader.jsx';
import FileDrop from '../../components/media/FileDrop.jsx';
import { useToast } from '../../components/Toast.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';
import { BIO_MAX, NAME_MAX, getAuthor, updateProfile, validateProfile } from '../../lib/authors.js';

const OFFLINE_MESSAGE = 'Không thể kết nối, vui lòng thử lại';
const errorMessage = (e, fallback) => (e?.offline ? OFFLINE_MESSAGE : e?.message || fallback);

export default function ProfileEditPage() {
  const toast = useToast();
  const { user, isContributor } = useAuth();
  const [initial, setInitial] = useState(null); // { fullName, bio, avatarUrl }
  const [values, setValues] = useState({ fullName: '', bio: '', avatarUrl: '' });
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);

  // Contributors have a public page with the current bio and avatar; others start from the stored user.
  useEffect(() => {
    let alive = true;
    const fromUser = { fullName: user?.fullName || '', bio: user?.bio || '', avatarUrl: user?.avatarUrl || '' };
    const apply = (v) => {
      if (!alive) return;
      setInitial(v);
      setValues(v);
    };
    if (isContributor && user?.id) {
      getAuthor(user.id)
        .then((a) => apply({ fullName: a.fullName || fromUser.fullName, bio: a.bio || '', avatarUrl: a.avatarUrl || '' }))
        .catch(() => apply(fromUser));
    } else {
      apply(fromUser);
    }
    return () => {
      alive = false;
    };
  }, [isContributor, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (key) => (value) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  async function onSubmit(e) {
    e.preventDefault();
    const errs = validateProfile(values);
    setErrors(errs);
    setServerError('');
    if (Object.keys(errs).length) return;
    const patch = {};
    const name = values.fullName.trim();
    const bio = values.bio.trim();
    if (name !== (initial.fullName || '').trim()) patch.fullName = name;
    if (bio !== (initial.bio || '').trim()) patch.bio = bio || null;
    if ((values.avatarUrl || '') !== (initial.avatarUrl || '')) patch.avatarUrl = values.avatarUrl || null;
    if (!Object.keys(patch).length) {
      toast.show('Không có thay đổi nào để lưu');
      return;
    }
    setBusy(true);
    try {
      const saved = await updateProfile(patch);
      const next = {
        fullName: saved?.fullName ?? name,
        bio: saved?.bio ?? (patch.bio === null ? '' : bio),
        avatarUrl: saved?.avatarUrl ?? (patch.avatarUrl === null ? '' : values.avatarUrl),
      };
      setInitial(next);
      setValues(next);
      toast.show('Đã lưu hồ sơ');
    } catch (err) {
      setServerError(errorMessage(err, 'Chưa lưu được hồ sơ'));
    } finally {
      setBusy(false);
    }
  }

  const title = isContributor ? 'Hồ sơ tác giả' : 'Hồ sơ';

  return (
    <div className="page page--narrow profile-edit">
      <AppHeader title={title} backTo="/account" />
      {initial === null ? (
        <p className="muted author-loading"><Icon name="loader" size={18} className="spin" /> Đang tải…</p>
      ) : (
        <form className="card studio-form profile-form" onSubmit={onSubmit} noValidate>
          <FileDrop
            kind="image"
            label="Ảnh đại diện"
            value={values.avatarUrl}
            onChange={set('avatarUrl')}
            hint="Ảnh vuông trông đẹp nhất."
          />

          <div className="field">
            <label className="field__label" htmlFor="pf-name">Họ tên *</label>
            <input
              id="pf-name"
              className="input"
              value={values.fullName}
              maxLength={NAME_MAX + 20}
              aria-invalid={!!errors.fullName}
              aria-describedby={errors.fullName ? 'pf-name-err' : undefined}
              onChange={(e) => set('fullName')(e.target.value)}
            />
            {errors.fullName ? <span id="pf-name-err" className="field__err" role="alert">{errors.fullName}</span> : null}
          </div>

          <div className="field">
            <label className="field__label" htmlFor="pf-bio">Giới thiệu</label>
            <textarea
              id="pf-bio"
              className="input profile-form__bio"
              rows={5}
              value={values.bio}
              aria-invalid={!!errors.bio}
              aria-describedby="pf-bio-count"
              onChange={(e) => set('bio')(e.target.value)}
            />
            <span id="pf-bio-count" className={`field__hint ${values.bio.trim().length > BIO_MAX ? 'profile-form__over' : ''}`}>
              {values.bio.trim().length}/{BIO_MAX} ký tự
            </span>
            {errors.bio ? <span className="field__err" role="alert">{errors.bio}</span> : null}
          </div>

          {serverError ? (
            <div className="alert alert--warn" role="alert">
              <Icon name="alert-triangle" size={18} className="alert__icon" />
              <div>{serverError}</div>
            </div>
          ) : null}

          <div className="row">
            <button type="submit" className="btn btn--primary" disabled={busy}>
              {busy ? <Icon name="loader" size={16} className="spin" /> : <Icon name="check-circle" size={16} />} Lưu hồ sơ
            </button>
            {isContributor && user?.id ? (
              <Link className="btn btn--ghost" to={`/authors/${encodeURIComponent(user.id)}`}>Xem trang tác giả</Link>
            ) : null}
          </div>
        </form>
      )}
    </div>
  );
}
