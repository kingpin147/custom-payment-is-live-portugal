import * as paymentProvider from 'interfaces-psp-v1-payment-service-provider';

/** @returns {import('interfaces-psp-v1-payment-service-provider').PaymentServiceProviderConfig} */
export function getConfig() {
    return {
        title: 'Ifthenpay Payments',
        paymentMethods: [{
            hostedPage: {
                title: 'Ifthenpay Payments',
                 billingAddressMandatoryFields: ["CITY"],
                logos: {
                    white: {
                        svg: 'https://your-logo-url.com/white-logo.svg',
                        png: 'https://static.wixstatic.com/media/c5af70_d13da4a1d70b4d41b791af3c388db9a5~mv2.jpeg'
                    },
                    colored: {
                        svg: 'https://your-logo-url.com/colored-logo.svg',
                        png: 'https://static.wixstatic.com/media/c5af70_d13da4a1d70b4d41b791af3c388db9a5~mv2.jpeg'
                    }
                }
            }
        }],
        credentialsFields: [{
            simpleField: {
                name: 'ifthenpayApiKey',
                label: 'API Key for Ifthenpay'
            }
        }]
    }
}
