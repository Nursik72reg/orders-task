-- Сколько клиент фактически заплатил за заказ (сумма со скидкой), в копейках.
-- NULL — неизвестно: заказ получен до того, как внешний API начал отдавать скидки.
-- В статистике такие заказы считаются оплаченными полностью (net = gross).
ALTER TABLE orders
  ADD COLUMN amount_paid_kop BIGINT
  CHECK (amount_paid_kop >= 0 AND amount_paid_kop <= amount_kop);
