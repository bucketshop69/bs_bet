/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
        "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
        "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    ],
    theme: {
        extend: {
            colors: {
                gray: {
                    700: '#374151',
                    800: '#1F2937',
                    900: '#111827',
                },
                blue: {
                    400: '#60A5FA',
                    600: '#2563EB',
                },
                green: {
                    800: '#065F46',
                    900: '#064E3B',
                },
                red: {
                    800: '#991B1B',
                    900: '#7F1D1D',
                },
                indigo: {
                    500: '#6366F1',
                    600: '#4F46E5',
                }
            },
        },
    },
    plugins: [],
}; 