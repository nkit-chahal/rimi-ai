import React from 'react';
import Modal, { ModalActions } from './Modal';
import Button from './Button';

export default function ConfirmDialog({
  open,
  title = 'Confirm',
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  onConfirm,
  onCancel,
}) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      footer={(
        <ModalActions>
          <Button variant="ghost" onClick={onCancel}>{cancelLabel}</Button>
          <Button variant={variant} onClick={onConfirm}>{confirmLabel}</Button>
        </ModalActions>
      )}
    >
      <p className="ui-confirm-message">{message}</p>
    </Modal>
  );
}
