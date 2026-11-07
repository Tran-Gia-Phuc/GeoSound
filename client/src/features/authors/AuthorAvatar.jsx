// UC18 — author avatar: the uploaded image, or the first letter of the name when
// there is none (or the image fails to load).
import { useState } from 'react';
import { initialsOf } from '../../lib/authors.js';

export default function AuthorAvatar({ name, url, size = 56 }) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.4) };
  if (url && !broken) {
    return <img className="author-avatar" src={url} alt="" style={style} onError={() => setBroken(true)} />;
  }
  return (
    <span className="author-avatar author-avatar--initials" aria-hidden="true" style={style}>
      {initialsOf(name)}
    </span>
  );
}
