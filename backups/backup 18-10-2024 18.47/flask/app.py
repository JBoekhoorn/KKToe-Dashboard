from flask import Flask, render_template, request, redirect, url_for, session, flash
from flask_mysqldb import MySQL
import bcrypt
import os

app = Flask(__name__)

# Configuratie van de MySQL-database
app.config['MYSQL_HOST'] = 'localhost'  # Vervang door jouw MySQL-host
app.config['MYSQL_USER'] = 'admin'  # Vervang door jouw MySQL-gebruikersnaam
app.config['MYSQL_PASSWORD'] = 'password'  # Vervang door jouw MySQL-wachtwoord
app.config['MYSQL_DB'] = 'kktoe'  # Vervang door jouw database naam

# Initieer de MySQL-extensie
mysql = MySQL(app)

# Geheime sleutel voor sessies
app.secret_key = os.urandom(24)  # Of gebruik een veilige omgevingsvariabele

@app.route('/')
def home():
    if 'user_id' in session:
        return redirect(url_for('account'))
    return render_template('login.html')

@app.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        email = request.form['email']
        password = request.form['password']
        
        # Hash het wachtwoord
        hashed_password = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt())

        # Voeg de gebruiker toe aan de database
        cur = mysql.connection.cursor()
        cur.execute("INSERT INTO users (email, password) VALUES (%s, %s)", (email, hashed_password))
        mysql.connection.commit()
        cur.close()

        flash('Registratie succesvol! U kunt nu inloggen.', 'success')
        return redirect(url_for('login'))

    return render_template('register.html')

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        email = request.form['email']
        password = request.form['password']
        
        # Controleer of de gebruiker bestaat
        cur = mysql.connection.cursor()
        cur.execute("SELECT * FROM users WHERE email = %s", (email,))
        user = cur.fetchone()
        cur.close()

        if user and bcrypt.checkpw(password.encode('utf-8'), user[2].encode('utf-8')):  # user[2] is het hashed password
            session['user_id'] = user[0]  # user[0] is het ID van de gebruiker
            flash('Inloggen succesvol!', 'success')
            return redirect(url_for('account'))
        else:
            flash('Inloggen mislukt! Controleer je e-mailadres en wachtwoord.', 'danger')

    return render_template('login.html')

@app.route('/account')
def account():
    if 'user_id' not in session:
        return redirect(url_for('login'))

    return render_template('account.html')  # Eenvoudige render zonder gebruikersdata

@app.route('/logout', methods=['POST'])
def logout():
    session.pop('user_id', None)
    flash('U bent succesvol uitgelogd.', 'success')
    return redirect(url_for('login'))

# Nieuwe route voor gebruikersbeheer
@app.route('/gebruikers', methods=['GET', 'POST'])
def gebruikers():
    if 'user_id' not in session:
        return redirect(url_for('login'))

    cur = mysql.connection.cursor()
    
    # Gebruikers ophalen
    cur.execute("SELECT * FROM users")
    gebruikers = cur.fetchall()
    cur.close()

    if request.method == 'POST':
        # Toevoegen van een nieuwe gebruiker
        email = request.form['email']
        password = request.form['password']
        hashed_password = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt())

        cur = mysql.connection.cursor()
        cur.execute("INSERT INTO users (email, password) VALUES (%s, %s)", (email, hashed_password))
        mysql.connection.commit()
        cur.close()

        flash('Gebruiker succesvol toegevoegd!', 'success')
        return redirect(url_for('gebruikers'))

    return render_template('gebruikers.html', gebruikers=gebruikers)

@app.route('/gebruiker-bewerken/<int:user_id>', methods=['GET', 'POST'])
def gebruiker_bewerken(user_id):
    if 'user_id' not in session:
        return redirect(url_for('login'))

    cur = mysql.connection.cursor()
    
    # Verkrijg gebruiker om te bewerken
    cur.execute("SELECT * FROM users WHERE id = %s", (user_id,))
    gebruiker = cur.fetchone()
    
    if request.method == 'POST':
        # Werk de gebruiker bij
        email = request.form['email']
        password = request.form['password']

        if password:  # Als er een nieuw wachtwoord is, hash het dan
            hashed_password = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt())
            cur.execute("UPDATE users SET email = %s, password = %s WHERE id = %s", (email, hashed_password, user_id))
        else:
            cur.execute("UPDATE users SET email = %s WHERE id = %s", (email, user_id))
        
        mysql.connection.commit()
        cur.close()

        flash('Gebruiker succesvol bijgewerkt!', 'success')
        return redirect(url_for('gebruikers'))

    cur.close()
    return render_template('gebruiker_bewerken.html', gebruiker=gebruiker)

@app.route('/gebruiker-verwijderen', methods=['POST'])
def gebruiker_verwijderen():
    if 'user_id' not in session:
        return redirect(url_for('login'))

    gebruiker_id = request.json['gebruiker_id']
    cur = mysql.connection.cursor()
    cur.execute("DELETE FROM users WHERE id = %s", (gebruiker_id,))
    mysql.connection.commit()
    cur.close()

    return {'success': True}

if __name__ == '__main__':
    app.run(debug=True)
