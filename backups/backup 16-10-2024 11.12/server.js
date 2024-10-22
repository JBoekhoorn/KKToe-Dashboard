const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const mysql = require('mysql2/promise'); // Gebruik mysql2 met promises
const session = require('express-session');
const bcrypt = require('bcrypt');

const app = express();
const PORT = 3000;

app.use(bodyParser.json());

// Stel de views directory en view engine in
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Middleware voor statische bestanden (CSS, afbeeldingen, etc.)
app.use(express.static(path.join(__dirname, 'public')));

// Body-parser middleware voor het verwerken van POST-verzoeken
app.use(bodyParser.json()); // Voor JSON requests
app.use(bodyParser.urlencoded({ extended: true })); // Voor URL-encoded requests

// Sessieconfiguratie
app.use(session({
    secret: 'jouw_geheime_sleutel',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // Zet dit op true als je HTTPS gebruikt
}));

// MySQL-configuratie
const db = mysql.createPool({
    host: 'localhost',
    user: 'admin',      // Vervang door jouw MySQL-gebruikersnaam
    password: 'password',  // Vervang door jouw MySQL-wachtwoord
    database: 'kktoe' // Vervang door jouw MySQL-database naam
});

// Verbinding maken met de database
db.getConnection()
    .then(conn => {
        console.log('Verbonden met de MySQL database');
        conn.release(); // Sluit de verbinding na controle
    })
    .catch(err => {
        console.error('Fout bij het verbinden met de database: ', err.stack);
    });

// Middelware voor rolcontrole
function checkRole(allowedRoles) {
    return (req, res, next) => {
        if (!req.session.user || !allowedRoles.includes(req.session.user.role)) {
            return res.status(403).send('Toegang geweigerd. Onvoldoende rechten.');
        }
        next();
    };
}

// Functie om tijd te formatteren in HH:MM
function formatTime(timeString) {
    if (timeString) {
        const timeParts = timeString.split(':');
        const hours = timeParts[0].padStart(2, '0');
        const minutes = timeParts[1].padStart(2, '0');
        return `${hours}:${minutes}`;
    }
    return '00:00'; // Standaard als tijd ontbreekt
}

// Route voor de hoofdpagina (omleiden naar inlogpagina)
app.get('/', (req, res) => {
    res.redirect('/login');
});

// Route voor de inlogpagina
app.get('/login', (req, res) => {
    res.render('login', { errorMessage: req.session.errorMessage });
    req.session.errorMessage = null;
});

// Route voor inloggen
app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        // Haal de gebruiker op met de bijbehorende rol uit de database
        const [results] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        if (results.length > 0) {
            const user = results[0];

            // Vergelijk het ingevoerde wachtwoord met het gehashte wachtwoord in de database
            const match = await bcrypt.compare(password, user.password);
            if (match) {
                // Sla de gebruiker op in de sessie, inclusief hun rol
                req.session.user = {
                    id: user.id,
                    email: user.email,
                    role: user.role // Voeg de rol toe aan de sessie
                };
                return res.redirect('/dashboard');
            }
        }

        req.session.errorMessage = 'Ongeldige inloggegevens, probeer het opnieuw.';
        return res.redirect('/login');
    } catch (err) {
        console.error(err);
        return res.redirect('/login');
    }
});

// Route voor het admin dashboard
app.get('/admin-dashboard', checkRole(['administrator']), (req, res) => {
    res.render('admin-dashboard', { title: 'Admin Dashboard' });
});

// Route voor Dashboard
app.get('/dashboard', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login'); // Controleer of de gebruiker ingelogd is
    }
    res.render('dashboard', { title: 'Welkom bij Mijn KKTOE Dashboard', user: req.session.user });
});

// Route voor Intekenen op diensten
app.get('/intekenen', checkRole(['techniek', 'kktoe', 'administrator']), async (req, res) => {
    const userRole = req.session.user.role;

    try {
        // Haal diensten op voor de respectieve rol
        const [results] = await db.query('SELECT * FROM diensten WHERE afdeling = ?', [userRole]);
        res.render('intekenen', { title: 'Intekenpagina', diensten: results });
    } catch (err) {
        console.error('Fout bij het ophalen van diensten: ', err);
        res.status(500).send('Fout bij het ophalen van diensten.');
    }
});

// Route voor het verwerken van de inschrijving (POST-verzoek)
app.post('/intekenen', checkRole(['techniek', 'kktoe', 'administrator']), async (req, res) => {
    const geselecteerdeDiensten = req.body.dienst; // Verkrijg de geselecteerde diensten uit het formulier
    const userId = req.session.user.id;

    if (!geselecteerdeDiensten) {
        return res.status(400).send('Selecteer ten minste één dienst.');
    }

    const geselecteerdeDienstenArray = Array.isArray(geselecteerdeDiensten) ? geselecteerdeDiensten : [geselecteerdeDiensten];

    try {
        for (const dienstId of geselecteerdeDienstenArray) {
            // Sla de inschrijving op in de database
            await db.query('INSERT INTO diensten (user_id, dienst_id) VALUES (?, ?)', [userId, dienstId]);
        }

        res.send('Je inschrijving is succesvol verwerkt.');
    } catch (err) {
        console.error('Fout bij het inschrijven: ', err);
        res.status(500).send('Fout bij het verwerken van de inschrijving.');
    }
});

// Route voor het bekijken van openstaande diensten
app.get('/openstaande-diensten', async (req, res) => {
    try {
        const [results] = await db.query('SELECT * FROM diensten WHERE user_id IS NULL');

        console.log('Resultaten van query:', results);

        // Format de tijden voor elke dienst
        const formattedResults = results.map(dienst => {
            return {
                ...dienst,
                aanvang: formatTime(dienst.aanvang), // Format de aanvangstijd
                einde: formatTime(dienst.einde) // Format de eindtijd
            };
        });

        if (formattedResults.length === 0) {
            return res.render('openstaande-diensten', { diensten: [], message: 'Geen openstaande diensten gevonden.' });
        }

        res.render('openstaande-diensten', { diensten: formattedResults, message: '' });
    } catch (error) {
        console.error('Fout bij het ophalen van diensten:', error);
        res.status(500).send('Fout bij het ophalen van diensten.');
    }
});

// Route voor het opslaan van ingetekende diensten
app.post('/diensten/inschrijven', async (req, res) => {
    const geselecteerdeDienstIds = req.body.dienst_ids; // Dit zijn de dienst_id's uit het formulier
    const userId = req.session.user.id; // Haal het id van de ingelogde gebruiker op

    if (!geselecteerdeDienstIds || geselecteerdeDienstIds.length === 0) {
        return res.status(400).json({ message: 'Geen diensten geselecteerd.' }); // Retourneer JSON
    }

    const query = `UPDATE diensten SET user_id = ? WHERE id IN (${geselecteerdeDienstIds.map(() => '?').join(',')})`;

    try {
        await db.query(query, [userId, ...geselecteerdeDienstIds]);
        res.json({ message: 'Diensten succesvol opgeslagen.' }); // Retourneer JSON bij succes
    } catch (err) {
        console.error('Fout bij het updaten van de diensten:', err);
        res.status(500).json({ message: 'Er is iets fout gegaan.' }); // Retourneer JSON
    }
});

// Route voor het aanmaken van een nieuwe dienst
app.post('/diensten-aanmaken', async (req, res) => {
    const { weekdag, datum, activiteit, soort_dienst, aanvang, einde } = req.body;

    try {
        await db.query('INSERT INTO diensten (weekdag, datum, activiteit, soort_dienst, aanvang, einde) VALUES (?, ?, ?, ?, ?, ?)', 
            [weekdag, datum, activiteit, soort_dienst, aanvang, einde]);
        res.redirect('/diensten-beheren');
    } catch (err) {
        console.error('Fout bij het toevoegen van de dienst: ', err);
        res.status(500).send('Er is een fout opgetreden bij het aanmaken van de dienst.');
    }
});

// Route voor het bekijken van gebruikers
app.get('/gebruikers', checkRole(['administrator']), async (req, res) => {
    try {
        const [results] = await db.query('SELECT * FROM users');
        res.render('gebruikers', { title: 'Gebruikersbeheer', gebruikers: results });
    } catch (err) {
        console.error('Fout bij het ophalen van gebruikers: ', err);
        res.status(500).send('Fout bij het ophalen van gebruikers.');
    }
});

// Route voor het aanmaken van gebruikers via de gebruikers-beheer pagina
app.get('/gebruiker-aanmaken', (req, res) => {
    res.render('gebruiker-aanmaken', { title: 'Nieuwe Gebruiker Aanmaken' });
});

// Haal de gebruikers op in Admin-gebruikersbeheer
app.get('/admin/gebruikers', (req, res) => {
    const gebruikers = []; // Voorbeeldarray, je zou dit uit de database moeten halen
    res.render('admin-gebruikers', { gebruikers });
});

// Start de server
app.listen(PORT, () => {
    console.log(`Server is gestart op http://localhost:${PORT}`);
});
