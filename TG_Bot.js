// Импорт необходимых модулей
const { Telegraf, Markup, session } = require('telegraf');
const axios = require('axios');
const moment = require('moment');

// Токен вашего бота и ключ API для OpenWeatherMap
const BOT_TOKEN = ' Bot_Token';
const OPENWEATHERMAP_API_KEY = 'OPENWEATHER_API';

// Создание объекта бота
const bot = new Telegraf(BOT_TOKEN);

// Использование сессий для отслеживания состояния пользователей
bot.use(session());

// Объект для хранения информации о пользователях
const users = {};

// Функция для получения погоды по названию города
async function getWeather(city) {
  const apiUrl = `https://api.openweathermap.org/data/2.5/forecast?q=${city}&appid=${OPENWEATHERMAP_API_KEY}&units=metric`;
  try {
    const response = await axios.get(apiUrl);

    if (response.status === 200) {
      return response.data;
    } else {
      throw new Error(`Error fetching weather data for "${city}".`);
    }
  } catch (error) {
    throw new Error(`Failed to retrieve weather data for "${city}". Please try again.`);
  }
}

// Функция для парсинга прогноза погоды
function parseWeatherForecast(weatherData) {
  const forecasts = weatherData.list;

  // Группировка прогнозов по дням
  const forecastsByDate = forecasts.reduce((acc, forecast) => {
    const date = moment.unix(forecast.dt).format('DD.MM.YY');
    if (!acc[date]) {
      acc[date] = [];
    }
    acc[date].push(forecast);
    return acc;
  }, {});

  // Вычисление средних температур за утро, день и вечер для каждого дня
  const temperaturesByDay = Object.entries(forecastsByDate).map(([date, forecasts]) => {
    const morningForecasts = forecasts.filter((forecast) => isMorning(forecast));
    const dayForecasts = forecasts.filter((forecast) => isDay(forecast));
    const eveningForecasts = forecasts.filter((forecast) => isEvening(forecast));

    const averageMorningTemperature = calculateAverageTemperature(morningForecasts);
    const averageDayTemperature = calculateAverageTemperature(dayForecasts);
    const averageEveningTemperature = calculateAverageTemperature(eveningForecasts);

    // День недели
    const dayOfWeek = moment(date, 'DD.MM.YY').format('dddd');

    const formattedTemperatures = [
      `Утро: ${formatTemperature(averageMorningTemperature)}`,
      `День: ${formatTemperature(averageDayTemperature)}`,
      `Вечер: ${formatTemperature(averageEveningTemperature)}`,
    ].filter(Boolean).join(', ');

    return `${date} (${translateDayOfWeek(dayOfWeek)}): ${formattedTemperatures}`;
  });

  return temperaturesByDay.join('\n');
}

// Функция для форматирования температуры с учетом NaN
function formatTemperature(temperature) {
  return isNaN(temperature) ? '-' : `${temperature.toFixed(2)}°C`;
}

// Функции для определения периода дня
function isMorning(forecast) {
  const hour = moment.unix(forecast.dt).hour();
  return hour >= 6 && hour < 12;
}

function isDay(forecast) {
  const hour = moment.unix(forecast.dt).hour();
  return hour >= 12 && hour < 18;
}

function isEvening(forecast) {
  const hour = moment.unix(forecast.dt).hour();
  return hour >= 18 && hour < 24;
}

// Функция для вычисления средней температуры
function calculateAverageTemperature(forecasts) {
  const temperatures = forecasts.map((forecast) => forecast.main.temp);
  return temperatures.reduce((sum, temp) => sum + temp, 0) / temperatures.length;
}

// Функция для перевода дня недели на русский
function translateDayOfWeek(dayOfWeek) {
  const translations = {
    Monday: 'Пн',
    Tuesday: 'Вт',
    Wednesday: 'Ср',
    Thursday: 'Чт',
    Friday: 'Пт',
    Saturday: 'Сб',
    Sunday: 'Вс',
  };

  return translations[dayOfWeek] || dayOfWeek;
}

// Перечисление для опций клавиатуры
const KeyboardOptions = {
  WEATHER: 'Узнать погоду',
  ADD_CITY: 'Добавить город',
};

// Команда для очистки сессии пользователя
bot.command('clear', (ctx) => {
  const userId = ctx.message.from.id;
  delete users[userId];
  ctx.reply('Сессия очищена.');
});

// Команда для старта работы с ботом
bot.command('start', (ctx) => {
  const userId = ctx.message.from.id;
  users[userId] = { cities: [] };
  ctx.reply('Привет! Я твой погодный телеграм-бот! Воспользуйтесь командой /addcity для добавления города.');
});

// Команда для добавления города
bot.command('addcity', (ctx) => {
  ctx.reply('Введите название города:');
  ctx.session.stage = 'add_city';
});

// Обработчик входящих текстовых сообщений
bot.on('text', async (ctx) => {
  const userId = ctx.message.from.id;
  const user = users[userId];

  console.log('Received text:', ctx.message.text, 'Stage:', ctx.session.stage, 'User:', user);

  // Обработка команды "Узнать погоду" без добавленных городов
  if (ctx.message.text === KeyboardOptions.WEATHER && (!user || user.cities.length === 0)) {
    ctx.reply('Вы еще не добавили города. Воспользуйтесь кнопкой "Добавить город".');
  } else if (ctx.message.text === KeyboardOptions.WEATHER && user && user.cities.length > 0) {
    // Обработка команды "Узнать погоду" с добавленными городами
    try {
      const weatherPromises = user.cities.map(async (city) => {
        const weatherData = await getWeather(city);
        const weatherInfo = parseWeatherForecast(weatherData);
        return `${city}:\n${weatherInfo}`;
      });

      const weatherResults = await Promise.all(weatherPromises);
      const weatherMessage = weatherResults.join('\n');

      ctx.reply(weatherMessage, getMainKeyboard());
    } catch (error) {
      console.error('Error fetching weather:', error);
      ctx.reply('Произошла ошибка при получении погоды. Попробуйте позже.', getMainKeyboard());
    }
  } else if (ctx.message.text === KeyboardOptions.ADD_CITY && user) {
    // Обработка команды "Добавить город"
    ctx.reply('Введите название города:');
    ctx.session.stage = 'add_city';
  } else if (ctx.session.stage === 'add_city' && user) {
    // Обработка этапа добавления города
    const newCity = ctx.message.text.trim().toUpperCase();

    if (user.cities.map((c) => c.toUpperCase()).includes(newCity)) {
      ctx.reply(`Город "${newCity}" уже есть в вашем списке городов. Введите другой город или выберите другое действие.`, getMainKeyboard());
    } else {
      try {
        await getWeather(newCity);
        users[userId].cities.push(newCity);
        ctx.reply(`Город "${newCity}" добавлен! Выберите действие:`, getMainKeyboard());
        ctx.session.stage = undefined;
      } catch (error) {
        console.error('Error adding new city:', error);
        ctx.reply(`Город "${newCity}" не найден. Пожалуйста, введите корректное название города.`);
      }
    }
  } else {
    // Обработка других текстовых сообщений
    console.log('Unhandled text:', ctx.message.text);
  }
});

// Функция для получения клавиатуры с основными опциями
function getMainKeyboard() {
  return Markup.keyboard([KeyboardOptions.WEATHER, KeyboardOptions.ADD_CITY]).resize().extra();
}

// Запуск бота
bot.launch().then(() => {
  console.log('Бот запущен');
}).catch((err) => {
  console.error('Ошибка при запуске бота:', err);
});
