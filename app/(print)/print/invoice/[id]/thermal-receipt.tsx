import type { InvoiceDocument } from './page';
import { PAYMENT_MODE_LABEL } from '@/lib/billing';
import { formatDate, formatTime } from '@/lib/utils/dates';
import { formatAmount } from '@/lib/utils/money';

/**
 * 80mm thermal receipt -- the default for an OPD counter (CLAUDE.md 7).
 *
 * Written for a monochrome roll printer: no logo, no rules that depend on
 * colour, no column that can be squeezed. Everything is either full width or
 * right-aligned against the 80mm edge, and the paper is cut wherever the
 * content ends.
 *
 * The same data renders as an A4 invoice next door. Neither template computes
 * anything -- the totals are what collect_payment stored.
 */
export function ThermalReceipt({ document }: { document: InvoiceDocument }) {
  const { hospital, invoice, lines, payments } = document;
  const live = payments.filter((payment) => !payment.is_reversed);

  return (
    <>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '13px', fontWeight: 700, textTransform: 'uppercase' }}>
          {hospital.name}
        </div>
        {hospital.address ? <div>{hospital.address}</div> : null}
        {hospital.phone ? <div>Ph {hospital.phone}</div> : null}
        {hospital.gstin ? <div>GSTIN {hospital.gstin}</div> : null}
      </div>

      <div className="rule" />

      {invoice.status === 'void' ? (
        <div style={{ textAlign: 'center', fontWeight: 700, letterSpacing: '2px' }}>
          *** VOID ***
        </div>
      ) : null}

      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>{invoice.invoice_no}</span>
        <span>
          {formatDate(invoice.invoice_date)} {formatTime(invoice.invoice_date)}
        </span>
      </div>

      <div className="rule" />

      <div>{invoice.patient_name_snapshot}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>{invoice.patient_mrn}</span>
        <span>Token {invoice.token_no}</span>
      </div>
      {invoice.doctor_name ? <div>Dr {invoice.doctor_name}</div> : null}
      {invoice.department_name ? <div>{invoice.department_name}</div> : null}

      <div className="solid" />

      {/* Description on its own line, figures under it -- 80mm cannot hold a
          long service name and four columns without wrapping something. */}
      <table>
        <tbody>
          {lines.map((line) => (
            <tr key={line.id}>
              <td colSpan={2} style={{ paddingBottom: '1mm' }}>
                <div>{line.description}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>
                    {line.qty} x {formatAmount(line.unit_price)}
                    {line.tax_rate > 0 ? ` +${line.tax_rate}%` : ''}
                  </span>
                  <span className="num">{formatAmount(line.amount)}</span>
                </div>
              </td>
            </tr>
          ))}

          {lines.length === 0 ? (
            <tr>
              <td>
                {/* void_invoice releases the lines back to the visit, so a
                    voided bill has none to reprint. The stored totals below
                    are still exactly what was charged. */}
                <div style={{ fontStyle: 'italic' }}>
                  Charges returned to the visit when this bill was voided.
                </div>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <div className="solid" />

      <table>
        <tbody>
          <tr>
            <td>Subtotal</td>
            <td className="num">{formatAmount(invoice.subtotal)}</td>
          </tr>
          {invoice.tax_total > 0 ? (
            <tr>
              <td>GST</td>
              <td className="num">{formatAmount(invoice.tax_total)}</td>
            </tr>
          ) : null}
          <tr style={{ fontSize: '12px', fontWeight: 700 }}>
            <td>TOTAL</td>
            <td className="num">{formatAmount(invoice.grand_total)}</td>
          </tr>
        </tbody>
      </table>

      <div className="rule" />

      <table>
        <tbody>
          {live.map((payment) => (
            <tr key={payment.id}>
              <td>
                {PAYMENT_MODE_LABEL[payment.mode]}
                {payment.reference ? ` ${payment.reference}` : ''}
              </td>
              <td className="num">{formatAmount(payment.amount)}</td>
            </tr>
          ))}
          {live.length === 0 ? (
            <tr>
              <td colSpan={2}>No payment received.</td>
            </tr>
          ) : null}
          {invoice.balance > 0 ? (
            <tr style={{ fontWeight: 700 }}>
              <td>BALANCE DUE</td>
              <td className="num">{formatAmount(invoice.balance)}</td>
            </tr>
          ) : null}
        </tbody>
      </table>

      {invoice.status === 'void' && invoice.void_reason ? (
        <>
          <div className="rule" />
          <div>Voided: {invoice.void_reason}</div>
        </>
      ) : null}

      <div className="rule" />

      <div style={{ textAlign: 'center' }}>
        {invoice.created_by_name ? <div>Billed by {invoice.created_by_name}</div> : null}
        {/* Hospital services are largely GST-exempt (CLAUDE.md 8). Saying so
            saves the counter the same question every day. */}
        {invoice.tax_total === 0 ? <div>Healthcare services are GST exempt</div> : null}
        <div style={{ marginTop: '2mm' }}>Get well soon</div>
        <div>Computer generated receipt</div>
      </div>
    </>
  );
}
