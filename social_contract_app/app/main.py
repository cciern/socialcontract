from flask import Flask, render_template_string

app = Flask(__name__)


@app.route("/")
def home():
    # Quick placeholder page so the server runs; swap to templates when ready.
    return render_template_string(
        """
        <!doctype html>
        <title>Social Contract App</title>
        <h1>Social Contract App</h1>
        <p>Build your features here.</p>
        """
    )


if __name__ == "__main__":
    app.run(debug=True)
