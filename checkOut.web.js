import { Permissions, webMethod } from 'wix-web-module';

// Backend function to generate Ifthenpay Simple Checkout URL
export const createIfthenpayCheckout = webMethod(Permissions.Anyone, (paymentDetails) => {
    // Replace with your Ifthenpay Gateway Key
    const gatewayKey = "UJYG-055497"; // Obtain from Ifthenpay
    const baseUrl = "https://gateway.ifthenpay.com/";

    // Construct the Simple Checkout URL with required parameters
    let paymentUrl = `${baseUrl}?token=${gatewayKey}&id=${paymentDetails.orderId}&amount=${paymentDetails.amount}&description=${encodeURIComponent(paymentDetails.description)}&lang=${paymentDetails.lang}&selected_method=${paymentDetails.selectedMethod}&accounts=${paymentDetails.accounts}`;

    // Optional parameters (add more as needed)
    if (paymentDetails.successUrl) {
        paymentUrl += `&success_url=${encodeURIComponent(paymentDetails.successUrl)}`;
    }
    if (paymentDetails.cancelUrl) {
        paymentUrl += `&cancel_url=${encodeURIComponent(paymentDetails.cancelUrl)}`;
    }
    if (paymentDetails.errorUrl) {
        paymentUrl += `&error_url=${encodeURIComponent(paymentDetails.errorUrl)}`;
    }
    if (paymentDetails.selectedMethod) {
        paymentUrl += `&selected_method=${paymentDetails.selectedMethod}`;
    }
    if (paymentDetails.iframe) {
        paymentUrl += `&iframe=${paymentDetails.iframe}`;
    }

    // Add other optional parameters such as accounts if needed
    if (paymentDetails.accounts) {
        paymentUrl += `&accounts=${paymentDetails.accounts}`;
    }

    return paymentUrl;
});
