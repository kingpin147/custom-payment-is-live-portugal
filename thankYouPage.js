import wixLocation from 'wix-location';
import wixData from 'wix-data';
import { confirmOrder, getOrder } from 'backend/getEvent.web';

$w.onReady(async function () {
    let tickets = [];
    let repeaterData = [];
    let EventId;

    // Hide repeater initially
    $w('#ticketRepeater').hide();

    function isValidUUID(id) {
        const regex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        return regex.test(id);
    }

    try {
        const q = wixLocation.query;
        const tid = q.tid || '';
        const oid = q.oid || '';
        if (!tid || !oid) {
            throw new Error('Missing transactionId or orderId in URL');
        }

        // Parse URL items
        let items = [];
        let i = 0;
        while (q[`items[${i}][Eid]`]) {
            items.push({
                itemId: q[`items[${i}][Eid]`],
                name: q[`items[${i}][Ename]`],
                quantity: Number(q[`items[${i}][Equantity]`]) || 0
            });
            i++;
        }

        if (items.length === 0) {
            throw new Error('No items found in URL query');
        }

        // Filter valid UUID items
        items = items.filter(item => isValidUUID(item.itemId));
        if (items.length === 0) {
            throw new Error('No valid ticket items found in URL query');
        }

        // Fetch tickets in one query
        const itemIds = items.map(item => item.itemId);
        const results = await wixData.query("Events/Tickets").hasSome("_id", itemIds).find();
        const ticketsMap = new Map(results.items.map(ticket => [ticket._id, ticket]));

        for (const item of items) {
            const ticket = ticketsMap.get(item.itemId);
            if (ticket) {
                tickets.push(ticket);
            } else {
                throw new Error(`No ticket found for itemId: ${item.itemId}`);
            }
        }

        if (tickets.length === 0) {
            throw new Error('No valid tickets found');
        }

        // Verify all tickets belong to the same event
        const eventIds = new Set(tickets.map(ticket => ticket.event));
        if (eventIds.size > 1) {
            throw new Error('All tickets must belong to the same event');
        }
        EventId = eventIds.values().next().value;

        // Confirm order
        let confirmOrderResponse = null;
        try {
            const options = { orderNumber: [oid] };
            confirmOrderResponse = await confirmOrder(EventId, options);
            await wixData.insert('logs', {
                phase: 'confirm_order_complete',
                data: { confirmOrderResponse },
                ts: new Date().toISOString()
            });
        } catch (e) {
            await wixData.insert('logs', {
                phase: 'confirm_order_error',
                data: { msg: e.message, stack: e.stack },
                ts: new Date().toISOString()
            });
            console.error('Confirm order failed:', e);
        }

        // Get order details
        let getOrderResponse = null;
        const identifiers = { eventId: EventId, orderNumber: oid };
        const options1 = { fieldset: ["TICKETS", "DETAILS"] };
        try {
            getOrderResponse = await getOrder(identifiers, options1);
            await wixData.insert('logs', {
                phase: 'get_order_complete',
                data: { getOrderResponse },
                ts: new Date().toISOString()
            });
        } catch (e) {
            await wixData.insert('logs', {
                phase: 'get_order_error',
                data: { msg: e.message, stack: e.stack },
                ts: new Date().toISOString()
            });
            console.error('Get order failed:', e);
            throw new Error('Failed to retrieve order details');
        }

        // Prepare repeater data
        repeaterData = getOrderResponse.map(ticket => ({
            ...ticket,
            qrCode: ticket.qrCode || '',
            checkInUrl: ticket.checkInUrl || '',
            walletPassUrl: ticket.walletPassUrl || ''
        }));

        // Bind to repeater
        $w('#ticketRepeater').data = repeaterData;
        $w('#ticketRepeater').onItemReady(($item, data) => {
            $item('#ticketName').text = data.ticketName || '';
            $item('#ticketPrice').text = data.ticketPrice || '';
            $item('#ticketDownloadUrl').link = data.pdfUrl || '';
        });

        // Show repeater
        $w('#ticketRepeater').show();

    } catch (e) {
        console.error('Global error:', e);
    }
});