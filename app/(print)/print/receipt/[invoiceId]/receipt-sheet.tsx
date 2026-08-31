import type { InvoiceDocument } from './document';
import { PAYMENT_MODE_LABEL } from '@/lib/billing';
import { formatDate, formatTime } from '@/lib/utils/dates';
import { formatAmount } from '@/lib/utils/money';

/**
 * The counter receipt (block 5).
 *
 * Written for a monochrome roll printer and rendered identically on A5: no
 * logo, no colour, no background fill, no box shadow. A thermal head prints
 * none of those, and a receipt designed with them comes out grey and
 * unreadable. Everything here is black text, a dashed rule, or right-aligned
 * against the paper edge.
 *
 * THE TOKEN IS THE POINT. It is the largest thing on the paper -- legible
 * across a waiting room, because that is the distance from which somebody
 * checks whether the number just called is theirs. The invoice number, which
 * matters to the hospital and to nobody else, is the smallest.
 *
 * Nothing here computes a total. Every figure is what collect_payment stored
 * (CLAUDE.md 3.2); a template that adds up its own lines is a template that
 * can disagree with the ledger.
 */
export function ReceiptSheet({ document }: { document: InvoiceDocument }) {
  const { hospital, invoice, lines, payments } = document;
  const live = payments.filter((payment) => !payment.is_reversed);
  const due = invoice.status === 'unpaid' || invoice.status === 'partial';

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

      {/* The token, across the room. */}
      <div style={{ textAlign: 'center', margin: '1mm 0 2mm' }}>
        <div style={{ fontSize: '9px', letterSpacing: '2px' }}>TOKEN</div>
        <div style={{ fontSize: '34px', fontWeight: 700, lineHeight: 1 }}>
          {invoice.token_no ?? '-'}
        </div>
        {invoice.doctor_name ? (
          <div style={{ fontWeight: 700 }}>Dr {invoice.doctor_name}</div>
        ) : null}
        {invoice.department_name ? <div>{invoice.department_name}</div> : null}
      </div>

      <div className="rule" />

      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>{formatDate(invoice.invoice_date)}</span>
        <span>{formatTime(invoice.invoice_date)}</span>
      </div>

      <div style={{ fontWeight: 700 }}>{invoice.patient_name_snapshot}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>MRN {invoice.patient_mrn}</span>
        <span>{invoice.visit_no}</span>
      </div>
      {invoice.patient_phone ? <div>{invoice.patient_phone}</div> : null}

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
                    {line.tax_rate > 0 ? ` +${line.tax_rate}% GST` : ''}
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
          {/* GST per line, never a blanket rate (CLAUDE.md 8). A consultation
              is exempt and the pharmacy line next to it is not. */}
          {invoice.tax_total > 0 ? (
            <tr>
              <td>GST</td>
              <td className="num">{formatAmount(invoice.tax_total)}</td>
            </tr>
          ) : null}
          <tr style={{ fontSize: '13px', fontWeight: 700 }}>
            <td>TOTAL</td>
            <td className="num">{formatAmount(invoice.grand_total)}</td>
          </tr>
        </tbody>
      </table>

      <div className="rule" />

      {due ? (
        <div
          style={{
            textAlign: 'center',
            fontWeight: 700,
            letterSpacing: '2px',
            border: '1px solid #000',
            padding: '1.5mm 0',
          }}
        >
          PAYMENT DUE {formatAmount(invoice.balance)}
        </div>
      ) : null}

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
          {live.length === 0 && !due ? (
            <tr>
              <td colSpan={2}>Nothing to pay.</td>
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
        {invoice.created_by_name ? <div>Collected by {invoice.created_by_name}</div> : null}
        <div>{invoice.invoice_no}</div>
        {/* Hospital services are largely GST-exempt (CLAUDE.md 8). Saying so
            saves the counter the same question every day. */}
        {invoice.tax_total === 0 ? <div>Healthcare services are GST exempt</div> : null}
        <div style={{ marginTop: '2mm' }}>Get well soon</div>
        <div>Computer generated receipt</div>
      </div>
    </>
  );
}
