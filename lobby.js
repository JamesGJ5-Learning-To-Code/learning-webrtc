const form = document.getElementById('join-form');

const getRoom = (e) => {
    e.preventDefault();
    const inviteCode = e.target.invite_link.value;
    // const roomPath = encodeURIComponent(inviteCode);
    window.location = `./index.html?room=${inviteCode}`;
}

form.addEventListener('submit', getRoom);
