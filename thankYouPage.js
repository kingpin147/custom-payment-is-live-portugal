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
        // Log start of onReady
        await wixData.insert('logs', {
            phase: 'onReady_start',
            data: { message: 'Page initialization started' },
            ts: new Date().toISOString()
        });

        const q = wixLocation.query;
        const tid = q.tid || '';
        const oid = q.oid || '';
        if (!tid || !oid) {
            throw new Error('Missing transactionId or orderId in URL');
        }

        // Log URL query parameters
        await wixData.insert('logs', {
            phase: 'url_query',
            data: { tid, oid, query: q },
            ts: new Date().toISOString()
        });

        let items = [];
        let i = 0;
        while (q[`items[${i}][Eid]`]) {
            const item = {
                itemId: q[`items[${i}][Eid]`],
                name: q[`items[${i}][Ename]`],
                quantity: Number(q[`items[${i}][Equantity]`]) || 0
            };
            items.push(item);
            await wixData.insert('logs', {
                phase: 'url_item_parsed_raw',
                data: { index: i, item },
                ts: new Date().toISOString()
            });
            i++;
        }

        if (items.length === 0) {
            throw new Error('No items found in URL query');
        }

        // Log raw items before filtering
        await wixData.insert('logs', {
            phase: 'items_raw',
            data: { items },
            ts: new Date().toISOString()
        });

        // Filter to only valid ticket-like items
        items = items.filter(item => isValidUUID(item.itemId));

        // Log filtered items
        await wixData.insert('logs', {
            phase: 'items_filtered',
            data: { filteredItems: items.map(item => item.itemId), count: items.length },
            ts: new Date().toISOString()
        });

        if (items.length === 0) {
            throw new Error('No valid ticket items found in URL query');
        }

        await wixData.insert('logs', {
            phase: 'url_parsed',
            data: { tid, oid, items, count: items.length },
            ts: new Date().toISOString()
        });

        // Fetch all tickets in one query
        const itemIds = items.map(item => item.itemId);
        await wixData.insert('logs', {
            phase: 'ticket_query_start',
            data: { itemIds },
            ts: new Date().toISOString()
        });

        const results = await wixData.query("Events/Tickets").hasSome("_id", itemIds).find();
        const ticketsMap = new Map(results.items.map(ticket => [ticket._id, ticket]));

        await wixData.insert('logs', {
            phase: 'ticket_query_complete',
            data: { foundTickets: results.items.length, itemIds },
            ts: new Date().toISOString()
        });

        for (let f = 0; f < items.length; f++) {
            try {
                const ticket = ticketsMap.get(items[f].itemId);
                if (ticket) {
                    tickets.push(ticket);
                    await wixData.insert('logs', {
                        phase: 'ticket_processed',
                        data: { itemId: items[f].itemId, ticket: { _id: ticket._id, price: ticket.price } },
                        ts: new Date().toISOString()
                    });
                } else {
                    throw new Error(`No ticket found for itemId: ${items[f].itemId}`);
                }
            } catch (e) {
                await wixData.insert('logs', {
                    phase: 'ticket_error',
                    data: { itemId: items[f].itemId, msg: e.message, stack: e.stack },
                    ts: new Date().toISOString()
                });
                console.error(`Error processing ticket for itemId: ${items[f].itemId}`, e);
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

        await wixData.insert('logs', {
            phase: 'event_id_verified',
            data: { EventId, ticketCount: tickets.length },
            ts: new Date().toISOString()
        });

        const options = {
            orderNumber: [oid]
        };
        await wixData.insert('logs', {
            phase: 'get_order_args',
            data: { EventId, options },
            ts: new Date().toISOString()
        });

        // Confirm payment first
        let confirmOrderResponse = await confirmOrder(EventId, options);
        await wixData.insert('logs', {
            phase: 'confirm_order_complete',
            data: { confirmOrderResponse },
            ts: new Date().toISOString()
        });

        // Get order details after confirmation
        let getOrderResponse = await getOrder({ orderNumber: oid }, options);
        await wixData.insert('logs', {
            phase: 'get_order_complete',
            data: { getOrderResponse },
            ts: new Date().toISOString()
        });

        // Use getOrderResponse directly for repeater data with additional details
        repeaterData = getOrderResponse.map(ticket => ({
            ...ticket,
            qrCode: ticket.qrCode || '',
            checkInUrl: ticket.checkInUrl || '',
            walletPassUrl: ticket.walletPassUrl || ''
        }));

        await wixData.insert('logs', {
            phase: 'repeater_data_prepared',
            data: { repeaterData },
            ts: new Date().toISOString()
        });

        // Bind to repeater
        await wixData.insert('logs', {
            phase: 'repeater_bind_start',
            data: { repeaterData },
            ts: new Date().toISOString()
        });

        $w('#ticketRepeater').data = repeaterData;
        $w('#ticketRepeater').onItemReady(($item, data) => {
            $item('#ticketName').text = data.ticketName || '';
            $item('#ticketPrice').text = data.ticketPrice || '';
            $item('#ticketDownloadUrl').link = data.pdfUrl || '';
        });

        // Show repeater after binding data
        $w('#ticketRepeater').show();

        await wixData.insert('logs', {
            phase: 'tickets_bound',
            data: { count: repeaterData.length, repeaterData },
            ts: new Date().toISOString()
        });

    } catch (e) {
        await wixData.insert('logs', {
            phase: 'global_error',
            data: { msg: e.message, stack: e.stack },
            ts: new Date().toISOString()
        });
        console.error('Global error:', e);
    }
});