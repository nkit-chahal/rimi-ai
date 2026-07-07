import React from 'react';

const VARIANTS = {
  primary: 'ui-btn ui-btn-primary',
  secondary: 'ui-btn ui-btn-secondary',
  ghost: 'ui-btn ui-btn-ghost',
  danger: 'ui-btn ui-btn-danger',
};

export default function Button({
  variant = 'primary',
  type = 'button',
  className = '',
  disabled = false,
  children,
  ...props
}) {
  return (
    <button
      type={type}
      className={`${VARIANTS[variant] || VARIANTS.primary} ${className}`.trim()}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
}
