import { useId, useState } from 'react';

export default function TextileCompareSlider({
  beforeSrc,
  afterSrc,
  beforeLabel = 'Source artwork',
  afterLabel = 'Seamless repeat',
  beforeAlt = 'Ivory cushion showing one unfinished placed botanical artwork',
  description = 'Drag to compare the original placement with the seamless result.',
  beforeImageClassName = '',
  ariaLabel = 'Compare source artwork with the seamless repeat',
}) {
  const descriptionId = useId();
  const [position, setPosition] = useState(48);

  return (
    <figure className="mk-compare">
      <div
        className="mk-compare-frame"
        style={{ '--comparison-position': position + '%' }}
      >
        <img
          className={`mk-compare-image ${beforeImageClassName}`.trim()}
          src={beforeSrc}
          alt={beforeAlt}
          width="1254"
          height="1254"
        />
        <div className="mk-compare-after" aria-hidden="true">
          <img
            className="mk-compare-image"
            src={afterSrc}
            alt=""
            width="1254"
            height="1254"
          />
        </div>

        <span className="mk-compare-label mk-compare-label-before">{beforeLabel}</span>
        <span className="mk-compare-label mk-compare-label-after">{afterLabel}</span>

        <div className="mk-compare-divider" aria-hidden="true">
          <span>
            <svg viewBox="0 0 24 24">
              <path d="m9 7-5 5 5 5M15 7l5 5-5 5" />
            </svg>
          </span>
        </div>

        <input
          className="mk-compare-range"
          type="range"
          min="8"
          max="92"
          value={position}
          aria-label={ariaLabel}
          aria-describedby={descriptionId}
          onChange={(event) => setPosition(Number(event.target.value))}
        />
      </div>

      <figcaption id={descriptionId}>
        <span>Before</span>
        {description}
        <span>After</span>
      </figcaption>
    </figure>
  );
}
