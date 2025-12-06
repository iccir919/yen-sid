# Yen Sid's Ride Recommender 🎢✨

A magical Disney ride recommendation application that helps you discover your perfect theme park attractions.

## 🌟 About

Yen Sid's Ride Recommender is a web application that provides personalized Disney ride recommendations. Named after the wise sorcerer from *Fantasia* (Disney spelled backwards), this tool helps visitors discover attractions that match their preferences.

## 🚀 Live Demo

Check out the live application: [yen-sid.vercel.app](https://yen-sid.vercel.app)

## 🛠️ Technologies Used

- **Frontend**: HTML, CSS, JavaScript
- **Deployment**: Vercel
- **Architecture**: Static web application with serverless API functions

## 🔌 APIs Used

This application integrates with several external APIs to provide real-time recommendations:

- **[OpenAI Chat API](https://platform.openai.com/docs/api-reference/chat)** - Powers intelligent ride recommendations using ChatGPT
- **[Theme Parks Wiki API](https://themeparks.wiki/api)** - Provides theme park data
  - `/children` endpoint - Retrieves park attractions and ride information
  - `/live` endpoint - Gets real-time wait times and ride status
- **[National Weather Service API](https://www.weather.gov/documentation/services-web-api)** - Fetches weather data to help plan your park visit

## 📁 Project Structure

```
yen-sid/
├── api/              # API endpoints and serverless functions
├── data/             # Ride data and recommendation logic
├── lib/              # Utility libraries and helper functions
├── index.html        # Main application page
├── script.js         # Application logic
├── styles.css        # Application styling
├── package.json      # Node.js dependencies and scripts
└── package-lock.json # Locked dependency versions
```

## 🎯 Features

- **AI-Powered Recommendations** - Uses ChatGPT to provide personalized ride suggestions based on your preferences
- **Real-Time Data** - Access live wait times and ride statuses from Theme Parks Wiki API
- **Weather Integration** - Check current weather conditions to plan your park visit
- **Interactive User Interface** - Easy-to-use interface for discovering your perfect attractions
- **Fast and Responsive Design** - Optimized performance across all devices
- **Deployed on Vercel** - Instant global availability with serverless architecture

## 💻 Installation & Setup

### Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- OpenAI API key

### Local Development

1. Clone the repository:
```bash
git clone https://github.com/iccir919/yen-sid.git
cd yen-sid
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the root directory and add your OpenAI API key:
```bash
OPENAI_API_KEY=your_openai_api_key_here
```

> **Note**: Get your OpenAI API key from [OpenAI Platform](https://platform.openai.com/api-keys)

4. Start a local development server:
```bash
npm start
# or use any static file server
npx serve .
```

5. Open your browser and navigate to `http://localhost:3000` (or the port shown in your terminal)

## 🌐 Deployment

This project is configured for easy deployment on Vercel:

1. Push your changes to GitHub
2. Connect your repository to Vercel
3. Add your `OPENAI_API_KEY` as an environment variable in Vercel project settings
4. Vercel will automatically deploy on every push to main

### Environment Variables

Make sure to set the following environment variable in your Vercel project:

```
OPENAI_API_KEY=your_openai_api_key_here
```

Alternatively, deploy manually:
```bash
vercel
```

## 🤝 Contributing

Contributions are welcome! Here's how you can help:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

This project is open source and available under the [MIT License](LICENSE).

## 👤 Author

**iccir919**

- GitHub: [@iccir919](https://github.com/iccir919)
- Project Link: [https://github.com/iccir919/yen-sid](https://github.com/iccir919/yen-sid)

## 🎭 About the Name

"Yen Sid" is "Disney" spelled backwards, named after the powerful sorcerer from Disney's *Fantasia*. The character appears as Mickey Mouse's mentor in "The Sorcerer's Apprentice."

## ⭐ Show Your Support

Give a ⭐️ if you like this project!

---

*Built with magic and JavaScript* ✨
