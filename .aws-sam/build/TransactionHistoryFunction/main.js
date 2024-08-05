// main.js

// Import necessary modules and packages
const mysql = require('mysql2/promise'); // MySQL module for connecting and executing queries
const Razorpay = require('razorpay'); // Razorpay module for payment processing
const { v4: uuidv4 } = require('uuid'); // UUID module for generating unique identifiers
require('dotenv').config(); // dotenv module for loading environment variables
const pool = require('./db'); // Import the database connection pool from db.js

// Razorpay configuration object with key id and secret
const razorpayConfig = {
    key_id: 'rzp_test_R5tlDvzNSdEuY4', // Razorpay test key id
    key_secret: 'WOCQDhSZNaPPOqSn6xiKZZVo', // Razorpay test key secret
};

// Initialize Razorpay instance with the configuration
const razorpayInstance = new Razorpay(razorpayConfig);

// Asynchronous function to create a payment
const createPayment = async (event) => {
    const { user_id, plan_id } = JSON.parse(event.body);
    const connection = await mysql.createConnection(dbConfig);

    try {
        const [userRows] = await connection.execute('SELECT * FROM users WHERE id = ?', [user_id]);
        if (userRows.length === 0) {
            return {
                statusCode: 404,
                headers: { 'Authorization-Status': 'false' },
                body: JSON.stringify({ error: true, message: 'User not found' }),
            };
        }
        const user = userRows[0];

        const [planRows] = await connection.execute('SELECT * FROM plans WHERE id = ?', [plan_id]);
        if (planRows.length === 0) {
            return {
                statusCode: 404,
                headers: { 'Authorization-Status': 'false' },
                body: JSON.stringify({ error: true, message: 'Plan not found' }),
            };
        }
        const plan = planRows[0];

        const orderOptions = {
            amount: plan.amount_in_rs * 100,
            currency: 'INR',
            receipt: uuidv4(),
            payment_capture: 1,
        };
        const order = await razorpayInstance.orders.create(orderOptions);

        const [result] = await connection.execute(
            'INSERT INTO transactions (payment_order_id, amount, created_at, updated_at, user_id, plan_id, status) VALUES (?, ?, NOW(), NOW(), ?, ?, ?)',
            [order.id, plan.amount_in_rs, user_id, plan_id, false]
        );

        await connection.end();

        return {
            statusCode: 200,
            headers: { 'Authorization-Status': 'true' },
            body: JSON.stringify({
                success: true,
                data: {
                    transaction_id: result.insertId,
                    payment_order_id: order.id,
                    amount: plan.amount_in_rs,
                    user_id: user_id,
                    plan_id: plan_id,
                    status: 'pending',
                },
            }),
        };
    } catch (error) {
        await connection.end();

        return {
            statusCode: 500,
            headers: { 'Authorization-Status': 'false', 'Error': error.message },
            body: JSON.stringify({ error: true, message: 'Internal server error' }),
        };
    }
};

// Asynchronous function to create a new plan
const createPlan = async (event) => {
    try {
        const body = JSON.parse(event.body);
        const { amount_in_rs, duration_in_months } = body;

        if (!amount_in_rs || !duration_in_months) {
            return {
                statusCode: 400,
                headers: { 'Authorization-Status': 'false' },
                body: JSON.stringify({ error: true, message: 'Invalid input' }),
            };
        }

        const [result] = await pool.query(
            'INSERT INTO plans (amount_in_rs, duration_in_months) VALUES (?, ?)',
            [amount_in_rs, duration_in_months]
        );

        return {
            statusCode: 201,
            headers: { 'Authorization-Status': 'true' },
            body: JSON.stringify({
                success: true,
                data: {
                    id: result.insertId,
                    amount_in_rs,
                    duration_in_months
                }
            }),
        };
    } catch (error) {
        console.error('Error creating plan:', error);

        return {
            statusCode: 500,
            headers: { 'Authorization-Status': 'false' },
            body: JSON.stringify({ error: true, message: 'Internal server error' }),
        };
    }
};

// Asynchronous function to delete a plan by its ID
const deletePlan = async (event) => {
    const planId = event.pathParameters.id;

    try {
        const [result] = await pool.query('DELETE FROM plans WHERE id = ?', [planId]);

        if (result.affectedRows === 0) {
            return {
                statusCode: 404,
                headers: { 'Authorization-Status': 'false' },
                body: JSON.stringify({ error: true, message: 'Plan not found' }),
            };
        }

        return {
            statusCode: 200,
            headers: { 'Authorization-Status': 'true' },
            body: JSON.stringify({
                success: true,
                data: { message: 'Plan deleted successfully' },
            }),
        };
    } catch (error) {
        console.error('Error deleting plan:', error);

        return {
            statusCode: 500,
            headers: { 'Authorization-Status': 'false' },
            body: JSON.stringify({ error: true, message: 'Failed to delete plan' }),
        };
    }
};

// Asynchronous function to get order details by ID
const getOrder = async (event) => {
    const { id } = event.pathParameters;
    const connection = await mysql.createConnection(dbConfig);

    try {
        const [rows] = await connection.execute('SELECT * FROM transactions WHERE id = ?', [id]);
        await connection.end();

        if (rows.length > 0) {
            return {
                statusCode: 200,
                headers: { 'Authorization-Status': 'true' },
                body: JSON.stringify({ success: true, data: rows[0] }),
            };
        } else {
            return {
                statusCode: 404,
                headers: { 'Authorization-Status': 'false' },
                body: JSON.stringify({ error: true, message: 'Order not found' }),
            };
        }
    } catch (error) {
        await connection.end();
        console.error('Error retrieving order:', error);

        return {
            statusCode: 500,
            headers: { 'Authorization-Status': 'false' },
            body: JSON.stringify({ error: true, message: 'Could not retrieve order' }),
        };
    }
};

// Asynchronous function to retrieve a list of plans from the database
const getPlanList = async () => {
    try {
        const [rows] = await pool.query('SELECT * FROM plans');

        return {
            statusCode: 200,
            headers: { 'Authorization-Status': 'true' },
            body: JSON.stringify({ success: true, data: rows }),
        };
    } catch (error) {
        console.error('Error fetching plan list:', error);

        return {
            statusCode: 500,
            headers: { 'Authorization-Status': 'false', 'Error': 'Internal server error' },
            body: JSON.stringify({ error: true, message: 'Internal server error' }),
        };
    }
};

// Asynchronous function to retrieve transaction history for a specific user
const transactionHistoryAPI = async (event) => {
    const userId = event.pathParameters.user_id;

    try {
        const [rows] = await pool.query(
            `SELECT 
                t.id AS transaction_id,
                t.payment_order_id,
                t.amount,
                t.created_at,
                t.updated_at,
                t.status,
                p.amount_in_rs,
                p.duration_in_months
            FROM 
                transactions t
            JOIN 
                registered_user_plans rup ON t.id = rup.transaction_id
            JOIN 
                plans p ON t.plan_id = p.id
            WHERE 
                t.user_id = ?`,
            [userId]
        );

        if (rows.length === 0) {
            return {
                statusCode: 404,
                headers: { 'Authorization-Status': 'false' },
                body: JSON.stringify({ error: true, message: 'No transactions found for this user' }),
            };
        }

        return {
            statusCode: 200,
            headers: { 'Authorization-Status': 'true' },
            body: JSON.stringify({
                success: true,
                data: rows,
            }),
        };
    } catch (error) {
        console.error('Error fetching transaction history:', error);

        return {
            statusCode: 500,
            headers: { 'Authorization-Status': 'false' },
            body: JSON.stringify({ error: true, message: 'Internal server error' }),
        };
    }
};

// Export the functions for external use
module.exports = {
    createPayment,
    getPlanList,
    createPlan,
    deletePlan,
    getOrder,
    transactionHistoryAPI
};
