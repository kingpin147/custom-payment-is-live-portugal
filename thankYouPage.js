import wixLocation from 'wix-location';
import wixData from 'wix-data';
import { confirmOrder, getOrder } from 'backend/getEvent.web';

$w.onReady(async function () {
    // Hide repeater initially
    $w('#ticketRepeater').hide();

    try {
        // Log start of onReady
        await wixData.insert('logs', {
            phase: 'onReady_start',
            data: { message: 'Thank-you page initialization started', url: wixLocation.url },
            ts: new Date().toISOString()
        });

        // Extract query parameters
        const q = wixLocation.query;
        const tid = q.tid || '';
        const oid = q.oid || '';
        const eid = q.eid || '';

        // Log full URL and query parameters
        await wixData.insert('logs', {
            phase: 'url_query',
            data: { tid, oid, eid, fullUrl: wixLocation.url, query: q },
            ts: new Date().toISOString()
        });

        if (!tid || !oid || !eid) {
            const errorMsg = `Missing query parameters: ${!tid ? 'tid ' : ''}${!oid ? 'oid ' : ''}${!eid ? 'eid' : ''}`;
           
            throw new Error(errorMsg);
        }

        // Confirm order
        let confirmOrderResponse = null;
        try {
            const options = { orderNumber: [oid] };
            confirmOrderResponse = await confirmOrder(eid, options);
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
            // Continue to getOrder even if confirmOrder fails
        }

        // Get order details
        let getOrderResponse = null;
        const identifiers = {
            eventId: eid,
            orderNumber: oid
        };
        const options1 = {
            fieldset: ["TICKETS", "DETAILS"]
        };
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
        const repeaterData = getOrderResponse.map(ticket => ({
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
        $w('#ticketRepeater').data = repeaterData;
        $w('#ticketRepeater').onItemReady(($item, data) => {
            $item('#ticketName').text = data.ticketName || '';
            $item('#ticketPrice').text = data.ticketPrice || '';
            $item('#ticketDownloadUrl').link = data.pdfUrl || '';
        });

        // Show repeater
        $w('#ticketRepeater').show();
        await wixData.insert('logs', {
            phase: 'tickets_bound',
            data: { count: repeaterData.length },
            ts: new Date().toISOString()
        });

    } catch (e) {
        await wixData.insert('logs', {
            phase: 'global_error',
            data: { msg: e.message, stack: e.stack, url: wixLocation.url },
            ts: new Date().toISOString()
        });
        console.error('Global error:', e);
        
    }
});