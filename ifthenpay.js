import * as paymentProvider from 'interfaces-psp-v1-payment-service-provider';
import { createIfthenpayCheckout } from 'backend/checkOut.web';
import wixData from 'wix-data';

/** Helpers */
const toTwoDecimals = (n) => Number(n).toFixed(2);
const centsToDecimal = (v) => {
    // accepts "14000" or 14000 or "140.00"
    if (v == null || v === '') return null;
    const str = String(v).trim();
    if (/^\d+$/.test(str)) return toTwoDecimals(Number(str) / 100); // cents
    if (/^\d+(\.\d{1,2})$/.test(str)) return toTwoDecimals(Number(str)); // already decimal
    return null;
};

const safeStr = (v) => (v == null ? '' : String(v));
const buildDescription = (order) => {
    // prefer explicit description text, else join item names
    const descFromOrder = order?.description?.text || order?.description?.title || '';
    if (descFromOrder) return safeStr(descFromOrder).slice(0, 150);

    const items = order?.description?.items || [];
    const names = items.map(i => safeStr(i?.name)).filter(Boolean);
    const joined = names.join(', ').trim() || 'Order Payment';
    return joined.slice(0, 150);
};

const encode = encodeURIComponent;
const ensureHttps = (url) => {
    const s = safeStr(url).trim();
    if (!s) return '';
    try {
        const u = new URL(s.startsWith('http') ? s : `https://${s.replace(/^\/+/, '')}`);
        return u.toString();
    } catch {
        return '';
    }
};

const yyyymmdd = (d) => {
    const dt = d instanceof Date ? d : new Date(d || Date.now());
    const y = dt.getUTCFullYear();
    const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const day = String(dt.getUTCDate()).padStart(2, '0');
    return `${y}${m}${day}`;
};

export const connectAccount = async (options, context) => {
    const { credentials } = options;
    return { credentials };
};

export const createTransaction = async (options, context) => {
    const { merchantCredentials, order, wixTransactionId } = options || {};

    // For issues, contact IfthenPay directly, as they are responsive and invested in ensuring system functionality.
    // Note: Apple Pay only appears on Apple devices and Safari browsers, as per IfthenPay.
    // This function is configured for production use only, with no test mode.

    // Log the initial transaction details to the logs collection
    await wixData.insert('logs', {
        merchantCredentials: merchantCredentials || null,
        order: order || null,
        wixTransactionId: wixTransactionId || null,
        timestamp: new Date().toISOString()
    });

    // Utility to generate a 5-digit ID
    const generateShortId = (id) => {
        if (!id) return Math.floor(10000 + Math.random() * 90000).toString(); // Random 5-digit number
        const numericId = parseInt(id.replace(/\D/g, ''), 10) || Date.now();
        return (numericId % 100000).toString().padStart(5, '0'); // Ensure 5 digits
    };

    // Utility to clean and shorten description
    const cleanDescription = (desc) => {
        if (!desc) return 'Order Payment';
        // Remove special characters and trim to 20 characters
        return desc.replace(/[^a-zA-Z0-9\s]/g, '').substring(0, 20).trim();
    };

    // Collect raw values
    const rawTotal = order?.totalAmount ?? order?.description?.totalAmount;
    const amount = centsToDecimal(rawTotal);
    const shortId = generateShortId(wixTransactionId);
    const description = cleanDescription(buildDescription(order));
    const lang = (order.lang || order.description?.buyerInfo?.buyerLanguage || 'EN').toUpperCase();
    const baseSuccess = 'https://www.live-ls.com/thank-you';
    const itemsRaw = Array.isArray(order?.description?.items) ? order.description.items : [];

    const params = new URLSearchParams();
    params.set('tid', shortId);
    params.set('oid', String(order?._id ?? ''));

    itemsRaw.forEach((item, i) => {
        if (!item) return;
        if (item._id) params.append(`items[${i}][Eid]`, String(item._id));
        if (item.name) params.append(`items[${i}][Ename]`, String(item.name));
        if (item.price !== undefined) params.append(`items[${i}][Eprice]`, String(item.price));
        if (item.quantity !== undefined) params.append(`items[${i}][Equantity]`, String(item.quantity));
        if (item.description !== undefined) params.append(`items[${i}][ESeatId]`, String(item.description));
    });

    const successUrl = ensureHttps(`${baseSuccess}?${params.toString()}`);
    const cancelUrl = ensureHttps('https://www.live-ls.com/');
    const errorUrl = ensureHttps('https://www.live-ls.com/');
    const selectedMethod = '1';
    const iframe = 'true';

    // Validate and log actionable errors
    if (!wixTransactionId) {
        console.error('ValidationError: missing wixTransactionId');
        return { code: 'VALIDATION_ERROR', message: 'Transaction ID missing' };
    }
    if (shortId.length !== 5 || isNaN(parseInt(shortId, 10))) {
        console.error('ValidationError: Transaction ID must be a 5-digit number', { shortId });
        return { code: 'ID_INVALID', message: 'Transaction ID must be a 5-digit number' };
    }
    if (description.length > 20) {
        console.error('ValidationError: Description exceeds 20 characters', { description });
        return { code: 'DESCRIPTION_INVALID', message: 'Description exceeds 20 characters' };
    }
    if (/[^a-zA-Z0-9\s]/.test(description)) {
        console.error('ValidationError: Description contains special characters', { description });
        return { code: 'DESCRIPTION_INVALID', message: 'Description contains special characters' };
    }
    if (amount == null) {
        console.error(`ValidationError: Amount is not valid. Received:`, rawTotal);
        return { code: 'AMOUNT_INVALID', message: 'Amount is not valid' };
    }
    if (!successUrl || !cancelUrl || !errorUrl) {
        console.error('ValidationError: One or more redirect URLs are invalid', { successUrl, cancelUrl, errorUrl });
        return { code: 'URL_INVALID', message: 'Redirect URL invalid' };
    }

    // Configure accounts for production (includes Apple Pay and Google Pay)
    const accounts = "MB|WUY-852467;CCARD|TAE-905027;MBWAY|SJS-387406;APPLE|MQS-647506;GOOGLE|WBA-783486";

    // Optional: ask backend for a token; fall back to direct URL if backend returns non-string
    let paymentUrl = null;
    try {
        const paymentDetails = {
            orderId: shortId,
            amount,
            description,
            lang,
            successUrl,
            cancelUrl,
            errorUrl,
            selectedMethod,
            iframe,
            accounts
        };

        const maybeUrl = await createIfthenpayCheckout(paymentDetails);
        if (typeof maybeUrl === 'string' && maybeUrl.startsWith('http')) {
            paymentUrl = maybeUrl;
        } else if (maybeUrl && typeof maybeUrl === 'object' && typeof maybeUrl.url === 'string') {
            paymentUrl = maybeUrl.url;
        }
    } catch (e) {
        console.error('createIfthenpayCheckout failed:', e?.message || e);
    }

    // If backend did not return a URL, construct one
    if (!paymentUrl) {
        const token = safeStr(options?.gatewayToken || 'UJYG-055497'); // Replace with real token flow
        const id = safeStr(shortId);
        const expire = yyyymmdd(new Date(Date.UTC(new Date().getUTCFullYear() + 1, 11, 31)));

        const qp = [
            `token=${encode(token)}`,
            `id=${encode(id)}`,
            `amount=${encode(amount)}`,
            `description=${encode(description)}`,
            `expire=${encode(expire)}`,
            `lang=${encode(lang)}`,
            `success_url=${encode(successUrl)}`,
            `cancel_url=${encode(cancelUrl)}`,
            `error_url=${encode(errorUrl)}`,
            `selected_method=${encode(selectedMethod)}`,
            `iframe=${encode(iframe)}`,
            `accounts=${encode(accounts)}`
        ].join('&');

        paymentUrl = `https://gateway.ifthenpay.com/?${qp}`;
    }

    // Final type guard for redirectUrl
    if (typeof paymentUrl !== 'string' || !paymentUrl.startsWith('http')) {
        console.error('ConstructionError: redirectUrl is not a valid string', paymentUrl);
        return { code: 'REDIRECT_URL_INVALID', message: 'redirectUrl must be string' };
    }

    return {
        pluginTransactionId: shortId,
        redirectUrl: paymentUrl,
    };
};

export const refundTransaction = async (options, context) => {
    return { success: true };
};