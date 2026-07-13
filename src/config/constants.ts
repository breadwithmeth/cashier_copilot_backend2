export const API_PREFIX = '/api/v1';
export const HIGH_RISK_MESSAGES: Record<string, string> = {
  transferred_item_missing_in_receipt: 'Check the receipt: a product was transferred but not scanned.',
  scanner_without_pos_event: 'The scanner was presented, but the product did not appear in the receipt.',
  container_missing_in_receipt: 'Check the container: the container was not added to the receipt.',
  payment_method_mismatch: 'Check the payment method and receipt amount.',
  payment_amount_mismatch: 'Check the payment method and receipt amount.',
  change_amount_mismatch: 'For a cash payment, announce the change amount.'
};
