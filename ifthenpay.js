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

    // Log the initial transaction details
    await wixData.insert('logs', {
        phase: 'create_transaction_start',
        data: { merchantCredentials, order, wixTransactionId },
        timestamp: new Date().toISOString()
    });

    // Utility to generate a 5-digit ID
    const generateShortId = (id) => {
        if (!id) return Math.floor(10000 + Math.random() * 90000).toString();
        const numericId = parseInt(id.replace(/\D/g, ''), 10) || Date.now();
        return (numericId % 100000).toString().padStart(5, '0');
    };

    // Utility to clean and shorten description
    const cleanDescription = (desc) => {
        if (!desc) return 'Order Payment';
        let cleaned = desc
            .replace(/<[^>]+>/g, '')
            .replace(/[^a-zA-Z0-9\s]/g, '')
            .substring(0, 20)
            .trim();
        return cleaned;
    };

    // Utility to validate UUID
    const isValidUUID = (id) => {
        const regex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        return regex.test(id);
    };

    // Collect raw values
    const rawTotal = order?.totalAmount ?? order?.description?.totalAmount;
    const amount = centsToDecimal(rawTotal);
    const shortId = generateShortId(wixTransactionId);
    const description = cleanDescription(buildDescription(order));
    const lang = (order.lang || order.description?.buyerInfo?.buyerLanguage || 'EN').toUpperCase();
    const baseSuccess = 'https://www.live-ls.com/thank-you';
    const itemsRaw = Array.isArray(order?.description?.items) ? order.description.items : [];

    // Filter valid ticket items
    const items = itemsRaw.filter(item => item._id && isValidUUID(item._id));
    await wixData.insert('logs', {
        phase: 'items_filtered',
        data: { filteredItems: items.map(item => item._id), count: items.length },
        timestamp: new Date().toISOString()
    });

    if (items.length === 0) {
        await wixData.insert('logs', {
            phase: 'error',
            data: { message: 'No valid ticket items found' },
            timestamp: new Date().toISOString()
        });
        return { code: 'NO_VALID_ITEMS', message: 'No valid ticket items found' };
    }

    // Fetch all tickets in one query
    const itemIds = items.map(item => item._id);
    await wixData.insert('logs', {
        phase: 'ticket_query_start',
        data: { itemIds },
        timestamp: new Date().toISOString()
    });

    const results = await wixData.query("Events/Tickets").hasSome("_id", itemIds).find();
    const ticketsMap = new Map(results.items.map(ticket => [ticket._id, ticket]));
    await wixData.insert('logs', {
        phase: 'ticket_query_complete',
        data: { foundTickets: results.items.length, itemIds },
        timestamp: new Date().toISOString()
    });

    const tickets = [];
    for (let item of items) {
        try {
            const ticket = ticketsMap.get(item._id);
            if (ticket) {
                tickets.push(ticket);
                await wixData.insert('logs', {
                    phase: 'ticket_processed',
                    data: { itemId: item._id, ticket: { _id: ticket._id, price: ticket.price } },
                    timestamp: new Date().toISOString()
                });
            } else {
                throw new Error(`No ticket found for itemId: ${item._id}`);
            }
        } catch (e) {
            await wixData.insert('logs', {
                phase: 'ticket_error',
                data: { itemId: item._id, msg: e.message, stack: e.stack },
                timestamp: new Date().toISOString()
            });
            console.error(`Error processing ticket for itemId: ${item._id}`, e);
        }
    }

    if (tickets.length === 0) {
        await wixData.insert('logs', {
            phase: 'error',
            data: { message: 'No valid tickets found' },
            timestamp: new Date().toISOString()
        });
        return { code: 'NO_VALID_TICKETS', message: 'No valid tickets found' };
    }

    // Verify all tickets belong to the same event
    const eventIds = new Set(tickets.map(ticket => ticket.event));
    if (eventIds.size > 1) {
        await wixData.insert('logs', {
            phase: 'error',
            data: { message: 'All tickets must belong to the same event' },
            timestamp: new Date().toISOString()
        });
        return { code: 'MULTIPLE_EVENTS', message: 'All tickets must belong to the same event' };
    }
    const eventId = eventIds.values().next().value;

    await wixData.insert('logs', {
        phase: 'event_id_verified',
        data: { eventId, ticketCount: tickets.length },
        timestamp: new Date().toISOString()
    });

    // Build simplified success URL
    const params = new URLSearchParams();
    params.set('tid', shortId);
    params.set('oid', String(order?._id ?? ''));
    params.set('eid', eventId);
    const successUrl = ensureHttps(`${baseSuccess}?${params.toString()}`);
    const cancelUrl = ensureHttps('https://www.live-ls.com/');
    const errorUrl = ensureHttps('https://www.live-ls.com/');

    // Validate inputs
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

    // Configure accounts for production
    const accounts = "MB|WUY-852467;CCARD|TAE-905027;MBWAY|SJS-387406;APPLE|MQS-647506;GOOGLE|WBA-783486;PAYSHOP|PEH-772027";
    const selectedMethod = '1';
    const iframe = 'true';

    // Attempt to create payment URL
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

    // Fallback URL construction
    if (!paymentUrl) {
        const token = safeStr(options?.gatewayToken || 'UJYG-055497');
        const id = safeStr(shortId);
        const expire = yyyymmdd(new Date(Date.UTC(new Date().getUTCFullYear() + 1, 11, 31)));

        const qp = [
            `token=${encode(token)}`,
            `id=${encode(id)}`,
            `amount=${encode(amount)}`,
            `description=${encode(description)}`,
            `lang=${encode(lang)}`,
            `success_url=${encode(successUrl)}`,
            `cancel_url=${encode(cancelUrl)}`,
            `error_url=${encode(errorUrl)}`,
            `selected_method=${encode(selectedMethod)}`,
            `iframe=${encode(iframe)}`
        ].join('&');

        paymentUrl = `https://gateway.ifthenpay.com/?${qp}`;
    }

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