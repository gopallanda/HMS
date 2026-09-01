/* eslint-disable @next/next/no-img-element */
import type { InvoiceDocument } from './document';
import { INVOICE_STATUS_LABEL, PAYMENT_MODE_LABEL } from '@/lib/billing';
import { formatDate, formatTime } from '@/lib/utils/dates';
import { amountInWords, formatAmount } from '@/lib/utils/money';

/**
 * A4 tax invoice -- the copy that leaves the building, for insurance,
 * reimbursement or a company account.
 *
 * Same data as the 80mm receipt (CLAUDE.md 7). This one has room for the logo,
 * the full line table, the amount in words and a signature block.
 *
 * next/image is not used here on purpose: the print engine needs the bytes at
 * layout time, and an optimised, lazily-loaded, srcset image is exactly the
 * wrong thing on paper.
 */
export function A4Invoice({ document }: { document: InvoiceDocument }) {
  const { hospital, invoice, lines, payments } = document;
  const live = payments.filter((payment) => !payment.is_reversed);
  const taxed = lines.some((line) => line.tax_rate > 0);

  return (
    <>
      <header style={{ display: 'flex', gap: '8mm', alignItems: 'flex-start' }}>
        {hospital.logo_url ? (
          <img
            src={hospital.logo_url}
            alt=""
            style={{ height: '18mm', width: 'auto', objectFit: 'contain' }}
          />
        ) : null}

        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '18px', fontWeight: 700 }}>{hospital.name}</div>
          {hospital.address ? <div>{hospital.address}</div> : null}
          <div>
            {hospital.phone ? <span>Phone {hospital.phone}</span> : null}
            {hospital.phone && hospital.gstin ? <span> &middot; </span> : null}
            {hospital.gstin ? <span>GSTIN {hospital.gstin}</span> : null}
          </div>
        </div>

        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '15px', fontWeight: 700, letterSpacing: '1px' }}>
            {taxed ? 'TAX INVOICE' : 'INVOICE'}
          </div>
          <div style={{ fontWeight: 700 }}>{invoice.invoice_no}</div>
          <div>
            {formatDate(invoice.invoice_date)} {formatTime(invoice.invoice_date)}
          </div>
          {invoice.status !== 'paid' ? (
            <div style={{ marginTop: '1mm', fontWeight: 700 }}>
              {INVOICE_STATUS_LABEL[invoice.status].toUpperCase()}
            </div>
          ) : null}
        </div>
      </header>

      <div className="solid" />

      {invoice.status === 'void' ? (
        <div
          style={{
            border: '1px solid #000',
            padding: '2mm 3mm',
            marginBottom: '3mm',
            fontWeight: 700,
          }}
        >
          VOID{invoice.void_reason ? ` — ${invoice.void_reason}` : ''}
          <div style={{ fontWeight: 400 }}>
            This invoice has been cancelled. The number stays on record and is not reused.
          </div>
        </div>
      ) : null}

      {/* Patient and visit, side by side. */}
      <div style={{ display: 'flex', gap: '8mm', marginBottom: '4mm' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '10px', textTransform: 'uppercase' }}>Patient</div>
          <div style={{ fontWeight: 700 }}>{invoice.patient_name_snapshot}</div>
          <div>MRN {invoice.patient_mrn}</div>
          {invoice.patient_phone ? <div>{invoice.patient_phone}</div> : null}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '10px', textTransform: 'uppercase' }}>Visit</div>
          <div>
            {invoice.visit_no} &middot; Token {invoice.token_no}
          </div>
          {invoice.doctor_name ? <div>Dr {invoice.doctor_name}</div> : null}
          {invoice.department_name ? <div>{invoice.department_name}</div> : null}
        </div>
      </div>

      <table>
        <thead>
          <tr style={{ borderBottom: '1px solid #000', fontSize: '10px', textAlign: 'left' }}>
            <th style={{ padding: '1.5mm 0', width: '8mm' }}>#</th>
            <th style={{ padding: '1.5mm 0' }}>Particulars</th>
            <th style={{ padding: '1.5mm 0', width: '18mm' }} className="num">
              Qty
            </th>
            <th style={{ padding: '1.5mm 0', width: '26mm' }} className="num">
              Rate
            </th>
            {taxed ? (
              <th style={{ padding: '1.5mm 0', width: '18mm' }} className="num">
                GST %
              </th>
            ) : null}
            <th style={{ padding: '1.5mm 0', width: '30mm' }} className="num">
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => (
            <tr key={line.id} style={{ borderBottom: '1px solid #ddd' }}>
              <td style={{ padding: '1.5mm 0' }}>{index + 1}</td>
              <td style={{ padding: '1.5mm 0' }}>{line.description}</td>
              <td className="num">{line.qty}</td>
              <td className="num">{formatAmount(line.unit_price)}</td>
              {taxed ? <td className="num">{line.tax_rate > 0 ? line.tax_rate : '-'}</td> : null}
              <td className="num">{formatAmount(line.amount)}</td>
            </tr>
          ))}

          {lines.length === 0 ? (
            <tr>
              <td colSpan={taxed ? 6 : 5} style={{ padding: '3mm 0', fontStyle: 'italic' }}>
                {/* void_invoice releases the lines back to the visit so it can
                    be re-billed correctly, so a voided invoice has no lines to
                    reprint. The stored totals below are what was charged. */}
                The charges on this invoice were returned to the visit when it was voided.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <div style={{ display: 'flex', gap: '8mm', marginTop: '4mm' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '10px', textTransform: 'uppercase' }}>Amount in words</div>
          <div style={{ fontWeight: 700 }}>{amountInWords(invoice.grand_total)}</div>

          {live.length > 0 ? (
            <div style={{ marginTop: '4mm' }}>
              <div style={{ fontSize: '10px', textTransform: 'uppercase' }}>Payments</div>
              <table>
                <tbody>
                  {live.map((payment) => (
                    <tr key={payment.id}>
                      <td>
                        {formatDate(payment.paid_at)} {formatTime(payment.paid_at)}
                      </td>
                      <td>{PAYMENT_MODE_LABEL[payment.mode]}</td>
                      <td>{payment.reference ?? ''}</td>
                      <td className="num">{formatAmount(payment.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>

        <div style={{ width: '70mm' }}>
          <table>
            <tbody>
              <tr>
                <td>Subtotal</td>
                <td className="num">{formatAmount(invoice.subtotal)}</td>
              </tr>
              <tr>
                <td>GST</td>
                <td className="num">{formatAmount(invoice.tax_total)}</td>
              </tr>
              {invoice.discount_amount > 0 ? (
                <tr>
                  <td>Concession</td>
                  <td className="num">-{formatAmount(invoice.discount_amount)}</td>
                </tr>
              ) : null}
              <tr style={{ borderTop: '1px solid #000', fontSize: '14px', fontWeight: 700 }}>
                <td style={{ padding: '1.5mm 0' }}>Total</td>
                <td className="num" style={{ padding: '1.5mm 0' }}>
                  {formatAmount(invoice.grand_total)}
                </td>
              </tr>
              <tr>
                <td>Paid</td>
                <td className="num">{formatAmount(invoice.paid_total)}</td>
              </tr>
              {invoice.balance > 0 ? (
                <tr style={{ fontWeight: 700 }}>
                  <td>Balance due</td>
                  <td className="num">{formatAmount(invoice.balance)}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '8mm', marginTop: '12mm', alignItems: 'flex-end' }}>
        <div style={{ flex: 1, fontSize: '10px' }}>
          {/* Hospital services are largely GST-exempt while pharmacy sales are
              taxable (CLAUDE.md 8), which is why the rate is per line above
              and never applied across the invoice. */}
          {invoice.tax_total === 0
            ? 'Healthcare services are exempt from GST. No tax has been charged on this invoice.'
            : 'GST is charged per line at the rate applicable to that item.'}
          {/* The concession and its reason. On the invoice that LEAVES the
              building (insurance, a company account, reimbursement) the
              difference between the lines and the total has to be explained on
              the paper itself, not in a system somebody else cannot open. */}
          {invoice.discount_amount > 0 && invoice.discount_reason ? (
            <div style={{ marginTop: '2mm' }}>
              Concession of {formatAmount(invoice.discount_amount)} applied: {invoice.discount_reason}
            </div>
          ) : null}
          <div style={{ marginTop: '2mm' }}>This is a computer generated invoice.</div>
        </div>
        <div style={{ width: '60mm', textAlign: 'center' }}>
          <div style={{ borderTop: '1px solid #000', paddingTop: '1.5mm' }}>
            {invoice.created_by_name ?? 'Authorised signatory'}
          </div>
          <div style={{ fontSize: '10px' }}>for {hospital.name}</div>
        </div>
      </div>
    </>
  );
}
