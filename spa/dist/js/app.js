const bffBaseUrl = 'http://localhost:5010'
const apiBaseUrl = 'http://localhost:5020'

const doRequest = async (method, baseUrl, path, data) => {
    console.log('doRequest', method, baseUrl, path, data);
    let options = {
	url: baseUrl + path,
	method,
	headers: {
            'accept': 'application/json',
            'content-type': 'application/json',
        },
	timeout: 2000,
	withCredentials: true  // Include cookies
    };
    if (data) {
	options.data = data
    }
    try {
	const response = await axios.request(options);
	console.log('Response data', response.data);
	if (response.data) {
	    return response.data;
	}
	return null;
    } catch (error) {
	console.log('Error', error);
	//showError(error);
	return null;
    }
}

const doBFFRequest = async (method, path, data) => {
    return doRequest(method, bffBaseUrl, path, data);
}

const doAPIRequest = async (method, path, data) => {
    return doRequest(method, apiBaseUrl, path, data);
}

const doBFFLogin = async () => {
    data = await doBFFRequest('GET', '/start', null);
    console.log('Login data', data);
    location.href = data['authRedirUrl']
}

const doBFFLogout = async () => {
    data = await doBFFRequest('GET', '/logout', null);
    console.log('Logout data', data);
    location.href = data['logoutUrl']
}

const doBFFContinue = async (pageUrl) => {
    data = await doBFFRequest('POST', '/continue', {pageUrl});
    console.log('Continue data', data);
    if (data && 'loggedIn' in data && data['loggedIn']) {
	$('#loginState').html('Logged in (click "Get User Info" for more user data)');
	//$('#loginState').html('Logged in as'+data['sub']);
    } else {
	$('#loginState').html('Not logged in');
    }
}

const doBFFGetUserInfo = async () => {
    data = await doBFFRequest('GET', '/userinfo', null);
    console.log('Userinfo data', data);
    if ('preferred_username' in data) {
	$('#loginState').html('Logged in as <b>'+data['preferred_username']+'</b>');
	$('#userInfo').html(JSON.stringify(data));
	//$('#loginState').html('Logged in as'+data['sub']);
    } else {
	$('#userInfo').html('');
    }
}

const doAPIWrite = async () => {
    let data = $('#objectData').val();
    console.log('API writing data', data);
    data = await doAPIRequest('POST', '/api/object', {data});
    console.log('API write response', data);
    $('#objectList').html('');
}

const doAPIListObjects = async () => {
    data = await doAPIRequest('GET', '/api/objects', null);
    console.log('API list objects response', data);
    $('#objectList').html(data.join('<br>'));
}

window.addEventListener('load', () => {
    $('#loginState').html('Unknown');
    $('#userInfo').html('No UserInfo');

    $('#doLogin').click(doBFFLogin);
    $('#doLogout').click(doBFFLogout);
    $('#doGetUserInfo').click(doBFFGetUserInfo);
    $('#doAPIWrite').click(doAPIWrite);
    $('#doAPIListObjects').click(doAPIListObjects);

    console.log('Location: ', location.href);
    doBFFContinue(location.href);
});
