// Shared by the editor and the OBS overlay: one note → its DOM.
// A note is { id, type: 'text', x, y, rot, text } or { id, type: 'image', x, y, rot, w, src }, in board pixels.

function placeNote(el, n) {
  const card = el.firstChild;
  el.style.left = n.x + 'px';
  el.style.top = n.y + 'px';
  card.style.transform = 'translateX(-50%) rotate(' + n.rot + 'deg)'; // centred under the pin, turning around its tip
  if (n.w) card.style.width = n.w + 'px';
}

function noteEl(n) {
  const el = document.createElement('div');
  const card = document.createElement('div');
  const pin = new Image();
  el.className = 'note';
  card.className = 'card ' + n.type;
  pin.className = 'pin';
  pin.src = 'assets/icons/pin.svg';
  pin.draggable = false;
  if (n.type === 'image') {
    const img = new Image();
    img.src = n.src;
    img.draggable = false;
    card.append(img);
  } else {
    const txt = document.createElement('div');
    txt.className = 'txt';
    txt.textContent = n.text;
    card.append(txt);
  }
  el.append(card, pin);
  placeNote(el, n);
  return el;
}

// Pinning: the card slides up and fades in, then the pin comes down into place, shrinking 125% → 100% as if
// pressed in from the viewer's side. Unpinning: the pin lifts off (growing back to 125%), then the card slides
// down and fades out, and the note is removed.
// Transform + opacity only, so the GPU runs it smoothly; the card's own translate/rotate is repeated in each keyframe.
const EASE_OUT = 'cubic-bezier(.2, .8, .2, 1)', EASE_IN = 'cubic-bezier(.6, 0, .8, .2)';
const slide = (y, base) => `translateY(${y}px) ${base || ''}`;

function pinIn(el) {
  const card = el.firstChild, base = card.style.transform;
  card.animate({ transform: [slide(40, base), slide(0, base)], opacity: [0, 1] }, { duration: 180, easing: EASE_OUT });
  el.lastChild.animate({ transform: [slide(-24, 'scale(1.25)'), slide(0, 'scale(1)')], opacity: [0, 1] }, { duration: 160, delay: 100, easing: EASE_OUT, fill: 'backwards' });
}

function pinOut(el) {
  const card = el.firstChild, base = card.style.transform;
  el.style.pointerEvents = 'none';
  el.lastChild.animate({ transform: [slide(0, 'scale(1)'), slide(-24, 'scale(1.25)')], opacity: [1, 0] }, { duration: 120, easing: EASE_IN, fill: 'forwards' });
  card.animate({ transform: [slide(0, base), slide(40, base)], opacity: [1, 0] }, { duration: 160, delay: 60, easing: EASE_IN, fill: 'forwards' })
    .finished.then(() => el.remove());
}
